import test from 'node:test';
import assert from 'node:assert/strict';
import programs from '../lib/guided-programs-official.json' with { type: 'json' };
import guided from '../lib/guided-official.json' with { type: 'json' };
import { validateAgainst2JProtocol, blockTypesOf } from '../lib/protocol/index.js';
import { lookup } from '../lib/blocks-store.js';
import * as store from '../lib/guided-store.js';

const routines = new Map(guided.routines.map(r => [r.id, r]));

test('official multi-week programs have unique ids and complete active routine references', () => {
  const ids = programs.programs.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of programs.programs) {
    assert.match(p.id, /^[a-z0-9-]+$/);
    assert.equal(p.weeks.length, p.weeksCount, p.id);
    assert.ok(p.weeksCount >= 2 && p.sessionsPerWeek >= 1, p.id);
    assert.ok(p.name && p.description && p.durationLabel && p.cover, p.id);
    assert.ok(Array.isArray(p.profileTypes) && p.profileTypes.length, p.id);
    for (const week of p.weeks) {
      assert.equal(week.sessions.length, p.sessionsPerWeek, p.id);
      assert.equal(new Set(week.sessions.map(s => s.day)).size, week.sessions.length, p.id);
      for (const session of week.sessions) {
        assert.ok(Number.isInteger(session.day) && session.day >= 0 && session.day <= 6, p.id);
        const r = routines.get(session.routineId);
        assert.ok(r?.official && r.active !== false, `${p.id}: ${session.routineId}`);
        assert.equal(r.validation?.result === 'FAIL', false, `${p.id}: invalid ${session.routineId}`);
      }
    }
  }
});

test('each program week passes the existing 2J program validator', () => {
  for (const p of programs.programs) for (const [index, week] of p.weeks.entries()) {
    const entries = week.sessions.map(s => routines.get(s.routineId));
    const types = Object.assign({}, ...entries.map(r => blockTypesOf(r.blocks)));
    const result = validateAgainst2JProtocol({ kind: 'program', goal: p.goal, level: p.level,
      days: entries.map(r => r.ex), blockTypes: types }, { lookup });
    assert.notEqual(result.result, 'FAIL', `${p.id}, week ${index + 1}: ${JSON.stringify(result.issues)}`);
  }
});

test('the Coach receives goal/level-filtered catalog references and compact active progress', () => {
  const general = store.compatiblePrograms({ goal: 'general', level: 'beginner' });
  assert.ok(general.some(p => p.id === 'g2j-beginner-4w'));
  assert.ok(!general.some(p => p.id === 'g2j-hiit-mix-4w'), 'advanced routine requirements are excluded for a beginner');
  const home = store.compatiblePrograms({ goal: 'general', level: 'beginner', availableEquipment: ['bodyweight'] });
  assert.ok(home.length > 0 && home.every(p => p.equipmentFit.compatibleSessions > 0));
  assert.deepEqual(store.compatiblePrograms({ goal: 'general', level: 'beginner', availableEquipment: [] }), [], 'no false equipment-compatible suggestions');
  const S = { activeProgramId: 'g2jp-m-1', programs: [{ id: 'g2jp-m-1', source: 'guided-v2', status: 'active', name: 'Test', meta: { goal: 'general' }, weeks: [{ sessions: [{ day: 2, routineId: 'r2j-mobility-fullbody' }] }] }],
    workouts: [{ src2j: { program: { programId: 'g2jp-m-1', sessionId: '1:2:0' } } }] };
  assert.deepEqual(store.activeProgramContext(S), { id: 'g2jp-m-1', name: 'Test', goal: 'general', status: 'active', completed: 1, total: 1, next: null });
});
