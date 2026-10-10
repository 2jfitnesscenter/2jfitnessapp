import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const TIMEOUT_LINE = /^(?:Error:\s*)?Test timed out in \d+ms$/
const VITEST_TEST_TIMEOUT_STACK = /^Error: STACK_TRACE_ERROR\n\s+at task \(file:\/\/.*@vitest\/runner\/dist\/chunk-artifact\.js:1784:\d+\)[\s\S]*?\n\s+at .+\.test\.[cm]?[jt]sx?:\d+:\d+[\s\S]*?\n\s+at Object\.collect \(file:\/\//

function isStackLine(line) {
  const value = line.trim()
  return !value || /^(?:at\s|❯\s|file:\/\/|https?:\/\/|\d+\s*[│|]|[│|]\s|┌|└|├|┬|─)/u.test(value)
}

function isTimeoutOnlyFailure(assertion) {
  const messages = assertion.failureMessages
  if (!Array.isArray(messages) || messages.length !== 1 || typeof messages[0] !== 'string') return false
  const lines = messages[0].split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!lines.length) return false
  if (TIMEOUT_LINE.test(lines[0])) return lines.slice(1).every(isStackLine)
  // Vitest's JSON reporter serializes timed-out test handlers using the
  // synthetic task-definition stack and drops the timeout message itself.
  // Accept only that exact runner stack plus an elapsed duration >= its
  // default 5s test timeout; arbitrary STACK_TRACE_ERROR or slow assertions
  // remain failures.
  return Number.isFinite(assertion.duration)
    && assertion.duration >= 5000
    && VITEST_TEST_TIMEOUT_STACK.test(messages[0])
}

export function classifyVitestReport(report, expectedTests) {
  if (!report || typeof report !== 'object' || !Number.isInteger(expectedTests) || expectedTests < 1) {
    return { kind: 'fail', reason: 'invalid-report-or-expected-count' }
  }
  const { numTotalTests: total, numPassedTests: passed, numFailedTests: failed } = report
  const pending = report.numPendingTests ?? 0
  const todo = report.numTodoTests ?? 0
  if (![total, passed, failed, pending, todo].every(Number.isInteger)
    || total !== expectedTests || passed + failed + pending + todo !== total) {
    return { kind: 'fail', reason: 'test-count-mismatch', total, passed, failed, pending, todo }
  }

  const files = Array.isArray(report.testResults) ? report.testResults : []
  const assertions = files.flatMap(file => Array.isArray(file.assertionResults) ? file.assertionResults : [])
  const failedAssertions = assertions.filter(assertion => assertion.status === 'failed')
  const failedFiles = files.filter(file => file.status === 'failed')
  const filesWithFailedAssertions = files.filter(file => Array.isArray(file.assertionResults) && file.assertionResults.some(assertion => assertion.status === 'failed'))
  const hasSuiteLoadError = files.some(file => typeof file.message === 'string' && file.message.trim().length > 0)
  // Vitest's JSON summary can report a larger numFailedTestSuites than the
  // concrete testResults when several workers time out together. The detailed
  // file/assertion records are authoritative: still reject any suite/import
  // error or failed file without corresponding failed assertions.
  if (hasSuiteLoadError || failedFiles.length !== filesWithFailedAssertions.length) {
    return { kind: 'fail', reason: 'suite-or-import-failure', total, passed, failed, failedSuites: failedFiles.length }
  }
  if (failed === 0 && passed === expectedTests && pending === 0 && todo === 0 && failedAssertions.length === 0 && failedFiles.length === 0) {
    return { kind: 'pass', total, passed, failed }
  }
  if (failed < 1 || pending !== 0 || todo !== 0 || failedAssertions.length !== failed || failedAssertions.some(assertion => !isTimeoutOnlyFailure(assertion))) {
    return { kind: 'fail', reason: 'non-timeout-or-unclassified-failure', total, passed, failed, pending, todo }
  }
  return { kind: 'timeout-only', total, passed, failed }
}

export function decideFrontendRetry(exitCode, report, expectedTests) {
  if (exitCode === 0) {
    const result = classifyVitestReport(report, expectedTests)
    return result.kind === 'pass' ? result : { ...result, kind: 'fail', reason: `exit-zero-${result.reason || result.kind}` }
  }
  const result = classifyVitestReport(report, expectedTests)
  return result.kind === 'timeout-only' ? result : { ...result, kind: 'fail', reason: `exit-${exitCode}-${result.reason || result.kind}` }
}

export function decideSequentialRetry(exitCode, report, expectedTests) {
  if (exitCode !== 0) return { kind: 'fail', reason: `retry-exit-${exitCode}` }
  const result = classifyVitestReport(report, expectedTests)
  return result.kind === 'pass' ? result : { ...result, kind: 'fail', reason: `retry-${result.reason || result.kind}` }
}

function main() {
  const [, , mode, reportPath, expectedArg, exitCodeArg] = process.argv
  if (!['initial', 'retry'].includes(mode) || !reportPath || !/^\d+$/.test(expectedArg || '') || !/^-?\d+$/.test(exitCodeArg || '')) {
    process.stderr.write('usage: node frontend-test-policy.mjs <initial|retry> <vitest.json> <expected-count> <exit-code>\n')
    process.exitCode = 1
    return
  }
  let decision
  try {
    const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null
    decision = mode === 'initial'
      ? decideFrontendRetry(Number(exitCodeArg), report, Number(expectedArg))
      : decideSequentialRetry(Number(exitCodeArg), report, Number(expectedArg))
  } catch (error) {
    decision = { kind: 'fail', reason: `report-unreadable:${error.message}` }
  }
  process.stdout.write(`VITEST_POLICY=${decision.kind.toUpperCase().replaceAll('-', '_')} ${JSON.stringify(decision)}\n`)
  process.exitCode = decision.kind === 'pass' ? 0 : decision.kind === 'timeout-only' ? 2 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
