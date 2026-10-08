import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyVitestReport, decideFrontendRetry, decideSequentialRetry } from './frontend-test-policy.mjs'

const EXPECTED = 1411
function report({ passed = EXPECTED, failures = [], pending = 0, todo = 0 } = {}) {
  const failed = failures.length
  return {
    numTotalTests: EXPECTED,
    numPassedTests: passed,
    numFailedTests: failed,
    numPendingTests: pending,
    numTodoTests: todo,
    numPassedTestSuites: failures.length ? 0 : 1,
    numFailedTestSuites: failures.length ? 1 : 0,
    testResults: [{ status: failures.length ? 'failed' : 'passed', message: '', assertionResults: failures.map((failure, index) => ({
      fullName: `case ${index + 1}`,
      status: 'failed',
      failureMessages: [failure],
    })) }],
  }
}
const timeout = 'Error: Test timed out in 5000ms\n ❯ src/views/example.test.jsx:18:7\n   16 | await render()\n   17 |   │\n   18 |   └─ timed out'
const assertion = 'AssertionError: expected true to be false\n ❯ src/lib/example.test.js:21:10'

test('A: complete initial 1411/1411 run passes without retry', () => {
  assert.equal(decideFrontendRetry(0, report(), EXPECTED).kind, 'pass')
})

test('B: a nonzero run with only Vitest timeouts is eligible for one sequential retry', () => {
  const initial = report({ passed: 1407, failures: Array(4).fill(timeout) })
  assert.deepEqual(decideFrontendRetry(1, initial, EXPECTED), { kind: 'timeout-only', total: EXPECTED, passed: 1407, failed: 4 })
})

test('concurrent timeout report uses concrete per-test records when Vitest suite summary is inconsistent', () => {
  const initial = report({ passed: EXPECTED - 7, failures: Array(7).fill(timeout) })
  initial.numFailedTestSuites = 14 // observed Vitest summary; seven detailed files each contain only a timeout
  assert.deepEqual(decideFrontendRetry(1, initial, EXPECTED), { kind: 'timeout-only', total: EXPECTED, passed: EXPECTED - 7, failed: 7 })
})

test('Vitest JSON synthetic task stack is timeout-only only at or beyond the 5s test timeout', () => {
  const synthetic = 'Error: STACK_TRACE_ERROR\n    at task (file:///repo/frontend/node_modules/@vitest/runner/dist/chunk-artifact.js:1784:27)\n    at Object.<anonymous> (file:///repo/frontend/node_modules/@vitest/runner/dist/chunk-artifact.js:1817:16)\n    at Object.<anonymous> (file:///repo/frontend/node_modules/@vitest/runner/dist/chunk-artifact.js:1563:28)\n    at chain (file:///repo/frontend/node_modules/@vitest/runner/dist/chunk-artifact.js:599:14)\n    at /repo/frontend/src/example.test.jsx:18:3\n    at Object.collect (file:///repo/frontend/node_modules/@vitest/runner/dist/chunk-artifact.js:1889:10)'
  const initial = report({ passed: EXPECTED - 1, failures: [synthetic] })
  initial.testResults[0].assertionResults[0].duration = 5025
  assert.equal(decideFrontendRetry(1, initial, EXPECTED).kind, 'timeout-only')
  initial.testResults[0].assertionResults[0].duration = 4999
  assert.equal(decideFrontendRetry(1, initial, EXPECTED).kind, 'fail')
  initial.testResults[0].assertionResults[0].duration = 6000
  initial.testResults[0].assertionResults[0].failureMessages[0] = 'AssertionError: expected a true result\n    at task (file:///repo/frontend/node_modules/@vitest/runner/dist/chunk-artifact.js:1784:27)'
  assert.equal(decideFrontendRetry(1, initial, EXPECTED).kind, 'fail')
})

test('C: a full sequential retry passes only at 1411/1411', () => {
  assert.equal(decideSequentialRetry(0, report(), EXPECTED).kind, 'pass')
})

test('D: an assertion failure does not qualify for retry', () => {
  assert.equal(decideFrontendRetry(1, report({ passed: 1410, failures: [assertion] }), EXPECTED).kind, 'fail')
})

test('E: timeout mixed with an assertion failure does not qualify for retry', () => {
  const mixed = report({ passed: 1409, failures: [timeout, assertion] })
  assert.equal(decideFrontendRetry(1, mixed, EXPECTED).kind, 'fail')
})

test('F: any failed sequential retry aborts, including another timeout', () => {
  const stillFailing = report({ passed: 1410, failures: [timeout] })
  assert.equal(decideSequentialRetry(1, stillFailing, EXPECTED).kind, 'fail')
  assert.equal(decideSequentialRetry(0, stillFailing, EXPECTED).kind, 'fail')
})

test('incomplete reports and pending tests cannot be classified as timeout-only', () => {
  assert.equal(classifyVitestReport(report({ passed: 1409, failures: [timeout], pending: 1 }), EXPECTED).kind, 'fail')
  assert.equal(classifyVitestReport({ numTotalTests: EXPECTED, numPassedTests: 1407, numFailedTests: 4, testResults: [] }, EXPECTED).kind, 'fail')
  const importFailure = report()
  importFailure.numFailedTestSuites = 1
  importFailure.testResults.push({ status: 'failed', message: 'Failed to load module', assertionResults: [] })
  assert.equal(classifyVitestReport(importFailure, EXPECTED).kind, 'fail')
})
