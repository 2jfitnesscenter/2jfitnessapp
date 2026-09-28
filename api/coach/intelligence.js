// Optional wording for an already-decided deterministic recommendation. Never returns an action.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cfgStore from './config.js';
import { adapterFor } from './adapters/index.js';
import { unprivilegedIds } from './adapters/spawn.js';
import { invokeWithRetry, aiLog } from './ai-run.js';
import { extractJSON } from './validate.js';

const TYPES = new Set(['PROGRESSION_READY', 'LOAD_TOO_HIGH', 'PLATEAU', 'MISSED_SESSION',
  'ADHERENCE_GOOD', 'EQUIPMENT_CONFLICT', 'RETURN_AFTER_GAP', 'PROGRAM_NEXT_SESSION',
  'NEXT_SESSION', 'PR_RECENT', 'CONTENT_SUGGESTION']);
const FIELDS = new Set(['days', 'sessions', 'weight', 'next', 'min', 'max', 'completed', 'total', 'thisWeek']);

export function compactSignal(input) {
  if (!TYPES.has(input?.type)) return null;
  const facts = {};
  for (const [key, value] of Object.entries(input.facts || {})) {
    if (FIELDS.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000)
      facts[key] = value;
  }
  return { type: input.type, facts };
}

export function validExplanation(text) {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  if (value.length < 20 || value.length > 280 || /[\r\n<>]/.test(value)) return null;
  // The model may rephrase, but cannot add quantities, diagnose or direct a plan change.
  if (/\d|sobreentren|overtrain|lesi[oó]n|injur|diagnos|debes|must|aumenta|reduce|increase|decrease|salud|health|whoop|recuperaci[oó]n|recovery|fatiga|fatigue|sue[nñ]o|sleep/i.test(value)) return null;
  return value;
}

const promptFor = (signal, repair = false) => `You are the 2J Coach. A deterministic engine already decided the signal below.
Only explain its meaning in one cautious, natural Spanish sentence. Do not make another decision,
give an exercise, load, set or repetition prescription, state a number, diagnose, or claim medical certainty.
Return exactly JSON: {"explanation":"..."}. No other keys. ${repair ? 'Your previous answer did not meet this contract. Repair it.' : ''}
Signal: ${JSON.stringify(signal)}`;

export async function explainSignal(input, { adapter: override = null } = {}) {
  const signal = compactSignal(input);
  if (!signal) return { ok: false, error: 'invalid-signal' };
  const cfg = cfgStore.load();
  const adapter = override || adapterFor(cfg.provider);
  if (!adapter) return { ok: false, error: 'unavailable' };
  const job = crypto.randomBytes(6).toString('hex');
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-intelligence-'));
  try {
    const ids = unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);
    const env = cfgStore.jobEnv(jobDir);
    for (let round = 0; round < 2; round++) {
      const result = await invokeWithRetry(adapter, {
        cfg, prompt: promptFor(signal, !!round), jobDir, env, model: cfg.model || null, timeoutMs: 30000
      }, { flow: 'intelligence-explanation', job, provider: cfg.provider, repair: !!round });
      if (result.failure) return { ok: false, error: result.failure.errorClass };
      const parsed = extractJSON(result.text);
      const value = parsed.value && Object.keys(parsed.value).length === 1 && validExplanation(parsed.value.explanation);
      if (value) { aiLog('AI_SUCCESS', { flow: 'intelligence-explanation', job }); return { ok: true, explanation: value }; }
      aiLog('AI_PARSE_ERROR', { flow: 'intelligence-explanation', job, round: round + 1 });
      if (!round) aiLog('AI_REPAIR', { flow: 'intelligence-explanation', job });
    }
    return { ok: false, error: 'unusable' };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
