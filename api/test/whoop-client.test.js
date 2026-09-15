import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRecentSleep } from '../whoop/client.js';

// Stubs the one thing this module talks to — Whoop's own API — so these tests run offline and
// pin the request/response shape without ever hitting the network.
function stubFetch(records) {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ records, next_token: null }) });
  return () => { globalThis.fetch = real; };
}

const sleepRecord = over => ({
  id: 's1', nap: false, score_state: 'SCORED',
  start: '2026-01-10T23:15:00.000Z', end: '2026-01-11T07:05:00.000Z',
  score: {
    stage_summary: {
      total_light_sleep_time_milli: 3 * 3600000,
      total_slow_wave_sleep_time_milli: 1.5 * 3600000,
      total_rem_sleep_time_milli: 2 * 3600000,
      total_awake_time_milli: 20 * 60000,
      total_in_bed_time_milli: 7.83 * 3600000,
    },
  },
  ...over,
});

test('sums the sleep-stage times (not in-bed/awake) into one minutes-asleep total, filed under the wake date', async () => {
  const restore = stubFetch([sleepRecord()]);
  try {
    const sleep = await fetchRecentSleep('tok');
    // 3h + 1.5h + 2h = 6.5h asleep = 390 minutes, filed under Jan 11 (the `end` date), not Jan 10
    assert.deepEqual(sleep, [{ d: '2026-01-11', v: 390, t: new Date('2026-01-11T12:00:00').getTime() }]);
  } finally { restore(); }
});

test('drops naps and unscored records', async () => {
  const restore = stubFetch([
    sleepRecord({ nap: true, end: '2026-01-11T07:05:00.000Z' }),
    sleepRecord({ score_state: 'PENDING_SCORE', end: '2026-01-12T07:05:00.000Z' }),
  ]);
  try {
    assert.deepEqual(await fetchRecentSleep('tok'), []);
  } finally { restore(); }
});

test('sums two scored records that share a wake date', async () => {
  const restore = stubFetch([
    sleepRecord({ id: 'a', end: '2026-01-11T02:00:00.000Z' }),
    sleepRecord({ id: 'b', end: '2026-01-11T07:05:00.000Z' }),
  ]);
  try {
    const sleep = await fetchRecentSleep('tok');
    assert.equal(sleep.length, 1);
    assert.equal(sleep[0].d, '2026-01-11');
    assert.equal(sleep[0].v, 780); // 390 + 390
  } finally { restore(); }
});

test('throws on a failed request rather than returning something that looks like real data', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false });
  try {
    await assert.rejects(() => fetchRecentSleep('tok'));
  } finally { globalThis.fetch = real; }
});
