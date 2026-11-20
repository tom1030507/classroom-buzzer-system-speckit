import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../../../src/db/connection.js';
import { migrate } from '../../../src/db/migrate.js';
import { transitionActivity } from '../../../src/features/realtime-buzzer/state.js';
import { readResults } from '../../../src/features/results-export/results.js';
import { createFixedClock } from '../../../src/lib/time.js';
import {
  closeActivity, insertActivity, insertGroup, insertGroupUnit, insertSingleUnit, insertSubmission, openActivity,
} from '../../helpers/fixtures.js';

const CLOSED_AT = '2026-11-20T08:30:00.000Z';
const at = (second) => `2026-11-20T08:01:${String(second).padStart(2, '0')}.000Z`;

/**
 * Unit 1 (Q3): Alpha first, Beta second. Unit 2 (group A: Q9, Q14): Beta first, Alpha second.
 * Unit 3 (Q20): no answers.
 */
function prepareActivity(t, { mode = 'SPEED' } = {}) {
  const db = openDatabase(':memory:');
  migrate(db);
  t.after(() => db.close());
  const deps = { db, clock: createFixedClock(CLOSED_AT) };
  const activityId = insertActivity(db, { mode });
  const alpha = insertGroup(db, activityId, 'Alpha');
  const beta = insertGroup(db, activityId, 'Beta');
  const single = insertSingleUnit(db, activityId, { questionKey: 'Q3' });
  const grouped = insertGroupUnit(db, activityId, {
    groupCode: 'A', questions: [{ questionKey: 'Q9' }, { questionKey: 'Q14' }],
  });
  const empty = insertSingleUnit(db, activityId, { questionKey: 'Q20' });
  openActivity(db, activityId);
  const [q9, q14] = grouped.questionIds;
  const submissions = {
    alphaSingle: insertSubmission(db, { activityId, unitId: single.unitId, groupId: alpha, acceptSeq: 1,
      acceptedAt: at(1), answers: [{ questionId: single.questionId, text: 'A first' }] }),
    betaGroup: insertSubmission(db, { activityId, unitId: grouped.unitId, groupId: beta, acceptSeq: 2,
      acceptedAt: at(2), answers: [{ questionId: q14, text: 'B fourteen' }, { questionId: q9, text: 'B nine' }] }),
    betaSingle: insertSubmission(db, { activityId, unitId: single.unitId, groupId: beta, acceptSeq: 3,
      acceptedAt: at(3), answers: [{ questionId: single.questionId, text: 'B second' }] }),
    alphaGroup: insertSubmission(db, { activityId, unitId: grouped.unitId, groupId: alpha, acceptSeq: 4,
      acceptedAt: at(4), answers: [{ questionId: q9, text: 'A nine' }, { questionId: q14, text: 'A fourteen' }] }),
  };
  return { db, deps, activityId, single, grouped, empty, submissions };
}

const resultRows = (db, activityId) => db.prepare(`
  SELECT r.submission_id, r.unit_id, r.final_rank, r.is_winner
  FROM results AS r JOIN submissions AS s ON s.id = r.submission_id
  WHERE s.activity_id = ? ORDER BY r.unit_id, r.final_rank
`).all(activityId).map((row) => Object.values(row));

const statusOf = (db, activityId) => db.prepare('SELECT status FROM activities WHERE id = ?').get(activityId).status;

test('AC-11 closing a speed activity saves every final rank in the same transaction', (t) => {
  const { db, deps, activityId, single, grouped, submissions: s } = prepareActivity(t);
  assert.deepEqual(transitionActivity(deps, activityId, 'CLOSED'), { id: activityId, mode: 'SPEED', status: 'CLOSED' });
  assert.deepEqual(resultRows(db, activityId), [
    [s.alphaSingle, single.unitId, 1, 1],
    [s.betaSingle, single.unitId, 2, 0],
    [s.betaGroup, grouped.unitId, 1, 1],
    [s.alphaGroup, grouped.unitId, 2, 0],
  ]);
});

test('AC-11 saved results reject updates and deletes', (t) => {
  const { db, deps, activityId } = prepareActivity(t);
  transitionActivity(deps, activityId, 'CLOSED');
  assert.throws(() => db.prepare('UPDATE results SET final_rank = 9').run(), /final results cannot be modified/);
  assert.throws(() => db.prepare('DELETE FROM results').run(), /final results cannot be deleted/);
  assert.equal(resultRows(db, activityId).length, 4);
});

test('a mode without a ranking cannot close, and the failed close leaves the activity open without results', (t) => {
  const { db, deps, activityId } = prepareActivity(t, { mode: 'FAIR' });
  assert.throws(() => transitionActivity(deps, activityId, 'CLOSED'), { status: 409, code: 'RANKING_UNAVAILABLE' });
  assert.equal(statusOf(db, activityId), 'OPEN');
  assert.deepEqual(resultRows(db, activityId), []);
});

test('FR-003 the result view lists every unit in order with ranks, accept order and answers, and no internal ids', (t) => {
  const { db, deps, activityId, single, grouped, empty } = prepareActivity(t);
  transitionActivity(deps, activityId, 'CLOSED');
  assert.deepEqual(readResults(db, activityId), {
    activity: { id: activityId, mode: 'SPEED', status: 'CLOSED', closedAt: CLOSED_AT },
    units: [
      {
        id: single.unitId, kind: 'SINGLE', label: 'Q:Q3', position: 1, questions: [{ key: 'Q3' }], noAnswer: false,
        entries: [
          { groupName: 'Alpha', acceptedOrder: 1, acceptedAt: at(1), rank: 1, isWinner: true,
            answers: [{ questionKey: 'Q3', text: 'A first' }] },
          { groupName: 'Beta', acceptedOrder: 2, acceptedAt: at(3), rank: 2, isWinner: false,
            answers: [{ questionKey: 'Q3', text: 'B second' }] },
        ],
      },
      {
        id: grouped.unitId, kind: 'GROUP', label: 'G:A', position: 2, questions: [{ key: 'Q9' }, { key: 'Q14' }],
        noAnswer: false,
        entries: [
          { groupName: 'Beta', acceptedOrder: 1, acceptedAt: at(2), rank: 1, isWinner: true,
            answers: [{ questionKey: 'Q9', text: 'B nine' }, { questionKey: 'Q14', text: 'B fourteen' }] },
          { groupName: 'Alpha', acceptedOrder: 2, acceptedAt: at(4), rank: 2, isWinner: false,
            answers: [{ questionKey: 'Q9', text: 'A nine' }, { questionKey: 'Q14', text: 'A fourteen' }] },
        ],
      },
      {
        id: empty.unitId, kind: 'SINGLE', label: 'Q:Q20', position: 3, questions: [{ key: 'Q20' }], noAnswer: true,
        entries: [],
      },
    ],
  });
});

test('FR-025 the accept order stays separate from a final rank that differs from it', (t) => {
  const { db, activityId, single, grouped, submissions: s } = prepareActivity(t, { mode: 'FAIR' });
  closeActivity(db, activityId, CLOSED_AT);
  const insert = db.prepare('INSERT INTO results (submission_id, unit_id, final_rank, is_winner) VALUES (?, ?, ?, ?)');
  insert.run(s.betaSingle, single.unitId, 1, 1);
  insert.run(s.alphaSingle, single.unitId, 2, 0);
  insert.run(s.alphaGroup, grouped.unitId, 1, 1);
  insert.run(s.betaGroup, grouped.unitId, 2, 0);
  const summary = (unit) => unit.entries.map(({ groupName, acceptedOrder, rank, isWinner }) => [
    groupName, acceptedOrder, rank, isWinner,
  ]);
  const [first, second] = readResults(db, activityId).units;
  assert.deepEqual(summary(first), [['Beta', 2, 1, true], ['Alpha', 1, 2, false]]);
  assert.deepEqual(summary(second), [['Alpha', 2, 1, true], ['Beta', 1, 2, false]]);
});

test('results are readable only after the activity has closed with saved results', (t) => {
  const { db, activityId } = prepareActivity(t);
  assert.throws(() => readResults(db, activityId), { status: 409, code: 'INVALID_PHASE' });
  closeActivity(db, activityId, CLOSED_AT);
  assert.throws(() => readResults(db, activityId), { status: 409, code: 'RESULTS_UNAVAILABLE' });
  assert.throws(() => readResults(db, 'missing-activity'), { status: 404, code: 'ACTIVITY_NOT_FOUND' });
});
