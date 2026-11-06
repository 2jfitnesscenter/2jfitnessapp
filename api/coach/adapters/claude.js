/* Claude Agent SDK adapter.
 *
 * This is deliberately the SDK rather than a hand-built `claude --print` invocation. The SDK
 * brings its matching Claude Code runtime with it, receives the owner-created setup token only
 * through the child environment, and keeps the model in a text-in / JSON-out lane: no tools,
 * no settings files, no MCP servers, and no persisted session history. */
import { spawn } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { unprivilegedIds } from './spawn.js';

const SDK_VERSION = 'Claude Agent SDK 0.3.220';
const OUTPUT_CAP = 4 * 1024 * 1024;
const SYSTEM_PROMPT = [
  'You are the 2J Fitness Center Coach.',
  'Answer only the supplied task and return exactly the requested JSON.',
  'You have no tools, filesystem access, external services, or persistent memory.'
].join(' ');

// The SDK owns the protocol, but Coach still owns the process boundary: its native runtime is
// launched as the same unprivileged `coach` user as the older CLI adapter.
function spawnAsCoach({ command, args, cwd, env, signal, onSpawn }) {
  const ids = unprivilegedIds();
  const child = spawn(command, args, { cwd, env, signal, stdio: ['pipe', 'pipe', 'pipe'], ...(ids || {}) });
  onSpawn?.(child);
  return child;
}

const childClosed = child => !!child && (child.exitCode !== null || child.signalCode !== null);
function waitForChildClose(child, ms) {
  if (!child || childClosed(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolve(value || childClosed(child));
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), ms);
    child.once('close', onClose);
  });
}

/** Abort the SDK and enforce a hard wall-clock deadline even if its async stream stops yielding. */
export async function readStreamWithTimeout(stream, { timeoutMs, abortController, getChild, stderr = () => '' }) {
  let timedOut = false;
  const read = readStream(stream, { stderr: '', timedOut: () => timedOut });
  let timer;
  const deadline = new Promise(resolve => {
    timer = setTimeout(() => resolve({ deadline: true }), timeoutMs);
  });
  const result = await Promise.race([read.then(value => ({ value })), deadline]);
  clearTimeout(timer);
  if (!result.deadline) return result.value;

  timedOut = true;
  abortController?.abort();
  const child = getChild?.();
  let terminated = !child || childClosed(child);
  if (child && !terminated) {
    try { child.kill('SIGTERM'); } catch { /* verify close below */ }
    terminated = await waitForChildClose(child, 500);
    if (!terminated) {
      try { child.kill('SIGKILL'); } catch { /* verify close below */ }
      terminated = await waitForChildClose(child, 1000);
    }
  }
  return {
    code: -1, text: '',
    stderr: `Claude Agent SDK call deadline exceeded after ${timeoutMs}ms; child ${terminated ? 'terminated' : 'termination unconfirmed'}${stderr() ? `; ${String(stderr()).slice(0, 500)}` : ''}`,
    timedOut: true, spawnError: false, timeoutMs, timeoutReason: 'call_deadline_exceeded', childTerminated: terminated
  };
}

/**
 * Turn the SDK's message stream into the adapter result ({ code, text, stderr, status,
 * timedOut, spawnError }). Exported for tests, which feed it fake streams.
 *
 * An API failure (429, 5xx, 529 overloaded, auth…) is reported on the assistant message and
 * again on a result whose subtype is still 'success' but with `is_error` set and the error text
 * as `result`. That text is NOT the model's answer: before this check it was parsed as one (the
 * error body even contains a JSON object), failed the contract, used up the repair round and
 * ended as "unusable" — the intermittent failures seen in production.
 */
export async function readStream(stream, io = { stderr: '', timedOut: () => false }) {
  let text = '', failure = '', status = null;
  try {
    for await (const message of stream) {
      if (message.type === 'assistant' && message.error) { failure = failure || `assistant error: ${message.error}`; continue; }
      if (message.type !== 'result') continue;
      if (message.subtype === 'success' && !message.is_error) { text = message.result; failure = ''; }
      else {
        status = message.api_error_status ?? status;
        failure = (message.subtype === 'success' ? message.result : message.errors?.join('\n')) || `Agent SDK stopped: ${message.subtype}`;
      }
    }
  } catch (e) {
    if (io.timedOut()) return { code: -1, text: '', stderr: 'the Agent SDK timed out', timedOut: true, spawnError: false };
    const msg = e instanceof Error ? e.message : String(e);
    // The runtime may exit non-zero AFTER delivering a complete result: keep the result.
    if (text && !failure) return { code: 0, text, stderr: io.stderr || msg, timedOut: false, spawnError: false };
    // Only a runtime that could not start is "missing"; a crash mid-call is a provider failure
    // (retryable), classified from its message by ../ai-run.js.
    const spawnFailed = e instanceof ReferenceError || /failed to spawn|ENOENT|native binary/i.test(msg);
    return { code: -1, text: '', stderr: [failure, io.stderr, msg].filter(Boolean).join('\n').slice(0, 4000), status, timedOut: false, spawnError: spawnFailed };
  }
  if (io.timedOut()) return { code: -1, text: '', stderr: 'the Agent SDK timed out', timedOut: true, spawnError: false };
  if (failure) return { code: 1, text: '', stderr: failure, status, timedOut: false, spawnError: false };
  if (!text) return { code: 1, text: '', stderr: io.stderr || 'the Agent SDK returned no result', timedOut: false, spawnError: false };
  return { code: 0, text, stderr: io.stderr, timedOut: false, spawnError: false };
}

export default {
  id: 'claude',
  runtime: 'Claude Agent SDK',

  async check() {
    // Importing this module verifies the SDK package at boot/build time. The real round-trip in
    // testRun() then verifies its bundled native runtime and the owner credential together.
    return { ok: true, version: SDK_VERSION };
  },

  async invoke({ prompt, jobDir, env, model, timeoutMs }) {
    const abortController = new AbortController();
    let child = null;
    let stderr = '';
    const stream = query({
        prompt,
        options: {
          abortController,
          cwd: jobDir,
          // `env` replaces rather than extends the SDK subprocess environment. config.jobEnv()
          // creates it from scratch, so this adds no server secrets to the model process.
          env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: '2jfitness-coach/1.3.0' },
          model: model || undefined,
          maxTurns: 1,
          tools: [],
          permissionMode: 'dontAsk',
          settingSources: [],
          skills: [],
          strictMcpConfig: true,
          persistSession: false,
          systemPrompt: SYSTEM_PROMPT,
          stderr: data => { if (stderr.length < OUTPUT_CAP) stderr += data; },
          spawnClaudeCodeProcess: options => spawnAsCoach({ ...options, onSpawn: process => { child = process; } })
        }
      });
    return readStreamWithTimeout(stream, { timeoutMs, abortController, getChild: () => child, stderr: () => stderr });
  }
};
