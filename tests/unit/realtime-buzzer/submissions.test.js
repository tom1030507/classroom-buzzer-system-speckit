import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { openDatabase } from '../../../src/db/connection.js';
import { migrate } from '../../../src/db/migrate.js';
import { getGroupSession, insertGroupSession } from '../../../src/features/activity-groups/sessions.js';
import {
  acceptSubmission, listOwnReceipts, listSubmissions,
} from '../../../src/features/realtime-buzzer/submissions.js';
import { createFixedClock } from '../../../src/lib/time.js';
import {
  closeActivity, insertActivity, insertGroup, insertGroupUnit, insertSingleUnit, openActivity,
} from '../../helpers/fixtures.js';

function prepareActivity(t, { open = true } = {}) {
  const db = openDatabase(':memory:');
  migrate(db);
  t.after(() => db.close());
  const deps = { db, clock: createFixedClock() };
  const activityId = insertActivity(db);
  const groups = ['Alpha', 'Beta'].map((name) => {
    const groupId = insertGroup(db, activityId, name);
    const token = randomBytes(32).toString('base64url');
    insertGroupSession(db, groupId, token);
    return { groupId, token };
  });
  const first = insertSingleUnit(db, activityId, { questionKey: 'Q3' });
  const second = insertGroupUnit(db, activityId, {
    groupCode: 'G', questions: [{ questionKey: 'Q9' }, { questionKey: 'Q14' }],
  });
  if (open) openActivity(db, activityId);
  return { db, deps, activityId, groups, first, second };
}

function request(group, unitId, body) {
  return {
    headers: { cookie: group ? `buzzer_group=${group.token}` : '' },
    params: { unitId: String(unitId) },
    body,
  };
}

const answer = (questionKey, text) => ({ questionKey, text });
const single = (text) => ({ answers: [answer('Q3', text)] });
const team = (first, second) => ({ answers: [answer('Q9', first), answer('Q14', second)] });

function counts(db) {
  return ['submissions', 'submission_answers'].map((table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
}

test('AC-05/06 assigns unique activity sequence numbers at the same timestamp and preserves order per unit', (t) => {
  const { deps, db, activityId, groups: [alpha, beta], first, second } = prepareActivity(t);
  acceptSubmission(deps, request(alpha, first.unitId, single('A first')));
  acceptSubmission(deps, request(beta, second.unitId, team('B grouped 1', 'B grouped 2')));
  acceptSubmission(deps, request(beta, first.unitId, single('B second')));
  acceptSubmission(deps, request(alpha, second.unitId, team('A grouped 1', 'A grouped 2')));

  const accepted = listSubmissions(db, activityId);
  assert.deepEqual(accepted.map((row) => [row.unitId, row.groupId, row.acceptSeq]), [
    [first.unitId, alpha.groupId, 1], [second.unitId, beta.groupId, 2],
    [first.unitId, beta.groupId, 3], [second.unitId, alpha.groupId, 4],
  ]);
  assert.deepEqual([...new Set(accepted.map((row) => row.acceptedAt))], ['2026-01-01T00:00:00.000Z']);
  assert.deepEqual(accepted[1].answers, [answer('Q9', 'B grouped 1'), answer('Q14', 'B grouped 2')]);
});

test('AC-07 returns the original opaque receipt on retry with a different valid answer', (t) => {
  const { deps, db, groups: [alpha, beta], first } = prepareActivity(t);
  acceptSubmission(deps, request(beta, first.unitId, single('Other team answer')));
  const text = `  ${'🌀'.repeat(994)}\n\u0000中 `;
  const received = acceptSubmission(deps, request(alpha, first.unitId, single(text)));
  assert.equal(received.created, true);
  assert.match(received.receipt.id, /^[a-f0-9]{32}$/);
  assert.deepEqual(received.receipt, {
    id: received.receipt.id, unitId: first.unitId, acceptedAt: '2026-01-01T00:00:00.000Z',
    answers: [answer('Q3', text)],
  });
  const retry = acceptSubmission(deps, request(alpha, first.unitId, single('Changed')));
  assert.deepEqual(retry, { created: false, receipt: received.receipt });
  const session = getGroupSession(deps, request(alpha));
  assert.deepEqual([...listOwnReceipts(db, session)], [[first.unitId, received.receipt]]);
  assert.deepEqual(counts(db), [2, 2]);
});

test('AC-08 rejects unknown identity, explicit identity claims, invalid units and invalid Unicode with no records', (t) => {
  const { deps, db, groups: [alpha, beta], first } = prepareActivity(t);
  const activity2 = insertActivity(db);
  const external = insertSingleUnit(db, activity2, { questionKey: 'Q3' });
  const invalid = [
    [request(null, first.unitId, single('answer')), 'GROUP_REQUIRED'],
    [request({ token: 'A'.repeat(43) }, first.unitId, single('answer')), 'GROUP_REQUIRED'],
    [request(alpha, first.unitId, { ...single('answer'), groupId: beta.groupId }), 'INVALID_GROUP'],
    [request(alpha, first.unitId, { ...single('answer'), activityId: activity2 }), 'INVALID_GROUP'],
    [request(alpha, 'bogus', single('answer')), 'INVALID_UNIT'],
    [request(alpha, external.unitId, single('answer')), 'INVALID_UNIT'],
    [request(alpha, first.unitId, single('　\u0085\n\t')), 'INVALID_ANSWERS'],
    [request(alpha, first.unitId, single('🌀'.repeat(1001))), 'INVALID_ANSWERS'],
    [request(alpha, first.unitId, single('\uD800')), 'INVALID_ANSWERS'],
  ];
  for (const [req, code] of invalid) {
    assert.throws(() => acceptSubmission(deps, req), { code });
  }
  assert.deepEqual(counts(db), [0, 0]);
});

test('AC-04/10 checks the current phase before accepting, including a retry after close', (t) => {
  const { deps, db, activityId, groups: [alpha, beta], first } = prepareActivity(t, { open: false });
  const submission = request(alpha, first.unitId, single('answer'));
  assert.throws(() => acceptSubmission(deps, submission), { code: 'INVALID_PHASE' });
  assert.deepEqual(counts(db), [0, 0]);
  openActivity(db, activityId);
  acceptSubmission(deps, submission);
  closeActivity(db, activityId);
  assert.throws(() => acceptSubmission(deps, submission), { code: 'INVALID_PHASE' });
  assert.throws(() => acceptSubmission(deps, request(beta, first.unitId, single('answer'))), { code: 'INVALID_PHASE' });
  assert.deepEqual(counts(db), [1, 1]);
});

test('AC-18 rejects missing, duplicate, unexpected, separately addressed, and invalid group answers', (t) => {
  const { deps, db, groups: [alpha], second } = prepareActivity(t);
  const invalid = [
    { answers: [answer('Q9', 'valid')] },
    { answers: [answer('Q9', 'valid'), answer('Q9', 'duplicate')] },
    { answers: [answer('Q9', 'valid'), answer('Q14', 'valid'), answer('Q3', 'extra')] },
    team('valid', '　'),
  ];
  for (const body of invalid) {
    assert.throws(() => acceptSubmission(deps, request(alpha, second.unitId, body)), { code: 'INVALID_ANSWERS' });
  }
  const wrongUnit = { answers: [answer('Q9', 'valid'), answer('Q3', 'wrong unit')] };
  assert.throws(() => acceptSubmission(deps, request(alpha, second.unitId, wrongUnit)), { code: 'INVALID_QUESTION' });
  const distinctQuestionId = second.questionIds.find((id) => id !== second.unitId);
  assert.throws(() => acceptSubmission(deps, request(alpha, distinctQuestionId, invalid[0])), { code: 'INVALID_UNIT' });
  assert.deepEqual(counts(db), [0, 0]);
});

test('AC-18 rolls back both the sequence and all rows when the second member insert fails', (t) => {
  const { deps, db, activityId, groups: [alpha], second } = prepareActivity(t);
  db.exec(`
    CREATE TRIGGER reject_second_test_answer BEFORE INSERT ON submission_answers
    WHEN NEW.question_id = ${second.questionIds[1]}
    BEGIN SELECT RAISE(ABORT, 'forced write failure'); END;
  `);
  const sendGroup = () => acceptSubmission(deps, request(alpha, second.unitId, {
    answers: [answer('Q14', 'second'), answer('Q9', 'first')],
  }));
  assert.throws(sendGroup, /forced write failure/);
  assert.deepEqual(counts(db), [0, 0]);
  db.exec('DROP TRIGGER reject_second_test_answer');
  const { receipt } = sendGroup();
  assert.deepEqual(receipt.answers, [answer('Q9', 'first'), answer('Q14', 'second')]);
  assert.deepEqual(counts(db), [1, 2]);
  assert.equal(listSubmissions(db, activityId)[0].acceptSeq, 1);
});
