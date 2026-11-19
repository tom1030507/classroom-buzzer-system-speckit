import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  closeActivity,
  insertActivity,
  insertGroup,
  insertGroupUnit,
  insertSingleUnit,
  insertSubmission,
  openActivity,
} from '../helpers/fixtures.js';
import { createTestDatabase } from '../helpers/test-app.js';

/**
 * The shared schema (000-base-schema.sql) is the last line of defence for the invariants
 * in spec.md §3–§6. Feature services must still validate first and return clear errors.
 */
describe('base schema invariants', () => {
  let db;
  beforeEach(() => {
    db = createTestDatabase();
  });

  const status = (activityId) => db.prepare('SELECT status FROM activities WHERE id = ?').get(activityId).status;

  describe('activities', () => {
    test('status only moves PREPARING → OPEN → CLOSED (§3)', () => {
      const activityId = insertActivity(db);
      assert.throws(() => closeActivity(db, activityId), /PREPARING -> OPEN -> CLOSED/);
      openActivity(db, activityId);
      assert.throws(
        () => db.prepare("UPDATE activities SET status = 'PREPARING', opened_at = NULL WHERE id = ?").run(activityId),
        /PREPARING -> OPEN -> CLOSED/,
      );
      closeActivity(db, activityId);
      assert.equal(status(activityId), 'CLOSED');
    });

    test('timestamps must match the status', () => {
      const activityId = insertActivity(db);
      assert.throws(
        () => db.prepare("UPDATE activities SET status = 'OPEN' WHERE id = ?").run(activityId),
        /CHECK constraint failed/,
      );
    });

    test('mode can change while PREPARING and is locked once OPEN (§4)', () => {
      const activityId = insertActivity(db);
      db.prepare("UPDATE activities SET mode = 'FAIR' WHERE id = ?").run(activityId);
      openActivity(db, activityId);
      assert.throws(
        () => db.prepare("UPDATE activities SET mode = 'SPEED' WHERE id = ?").run(activityId),
        /mode is locked/,
      );
    });

    test('join codes are unique', () => {
      insertActivity(db, { joinCode: 'ABC123' });
      assert.throws(() => insertActivity(db, { joinCode: 'ABC123' }), /UNIQUE constraint failed/);
    });
  });

  describe('student_groups', () => {
    test('group names are unique within an activity (FR-01)', () => {
      const a = insertActivity(db);
      const b = insertActivity(db);
      insertGroup(db, a, '第一組');
      insertGroup(db, b, '第一組');
      assert.throws(() => insertGroup(db, a, '第一組'), /UNIQUE constraint failed/);
    });

    test('groups can join only while PREPARING (AC-04)', () => {
      const activityId = insertActivity(db);
      insertGroup(db, activityId, 'A');
      openActivity(db, activityId);
      assert.throws(() => insertGroup(db, activityId, 'B'), /only while the activity is PREPARING/);
    });
  });

  describe('units and questions', () => {
    test('question keys are unique within an activity (FR-02)', () => {
      const activityId = insertActivity(db);
      insertSingleUnit(db, activityId, { questionKey: '1' });
      assert.throws(() => insertSingleUnit(db, activityId, { questionKey: '1' }), /UNIQUE constraint failed/);
    });

    test('two questions cannot map to the same cell', () => {
      const activityId = insertActivity(db);
      const cell = { sheetId: 7, row: 3, column: 2 };
      insertSingleUnit(db, activityId, { questionKey: '1', cell });
      assert.throws(() => insertSingleUnit(db, activityId, { questionKey: '2', cell }), /UNIQUE constraint failed/);
    });

    test('units and questions are locked once the activity is OPEN (§3)', () => {
      const activityId = insertActivity(db);
      const { unitId, questionId } = insertSingleUnit(db, activityId, { questionKey: '1' });
      openActivity(db, activityId);

      assert.throws(() => insertSingleUnit(db, activityId, { questionKey: '2' }), /units are locked/);
      assert.throws(() => db.prepare('UPDATE units SET position = 9 WHERE id = ?').run(unitId), /units are locked/);
      assert.throws(
        () => db.prepare('UPDATE questions SET row_index = 9 WHERE id = ?').run(questionId),
        /questions are locked/,
      );
      assert.throws(() => db.prepare('DELETE FROM units WHERE id = ?').run(unitId), /units are locked/);
    });

    test('re-import while PREPARING can replace units (cascade to questions)', () => {
      const activityId = insertActivity(db);
      insertGroupUnit(db, activityId, { groupCode: 'A', questions: [{ questionKey: '1' }, { questionKey: '2' }] });
      db.prepare('DELETE FROM units WHERE activity_id = ?').run(activityId);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM questions').get().n, 0);
    });
  });

  describe('submissions', () => {
    let activityId;
    let groupA;
    let single;

    beforeEach(() => {
      activityId = insertActivity(db);
      groupA = insertGroup(db, activityId, 'A');
      single = insertSingleUnit(db, activityId, { questionKey: '1' });
    });

    const submit = (overrides = {}) =>
      insertSubmission(db, {
        activityId,
        unitId: single.unitId,
        groupId: groupA,
        acceptSeq: 1,
        answers: [{ questionId: single.questionId, text: '答案' }],
        ...overrides,
      });

    test('are accepted only while OPEN (AC-04, AC-10)', () => {
      assert.throws(() => submit(), /only while the activity is OPEN/);
      openActivity(db, activityId);
      submit();
      closeActivity(db, activityId);
      assert.throws(() => submit({ acceptSeq: 2 }), /only while the activity is OPEN/);
    });

    test('one submission per group and unit; accept_seq unique per activity (AC-06, AC-07)', () => {
      const groupB = insertGroup(db, activityId, 'B');
      openActivity(db, activityId);
      submit();
      assert.throws(() => submit({ acceptSeq: 2 }), /UNIQUE constraint failed/);
      assert.throws(() => submit({ groupId: groupB, acceptSeq: 1 }), /UNIQUE constraint failed/);
      submit({ groupId: groupB, acceptSeq: 2 });
    });

    test('accepted submissions and answers are immutable (§2)', () => {
      openActivity(db, activityId);
      const submissionId = submit();
      assert.throws(
        () => db.prepare('UPDATE submissions SET accept_seq = 5 WHERE id = ?').run(submissionId),
        /cannot be modified/,
      );
      assert.throws(() => db.prepare('DELETE FROM submissions WHERE id = ?').run(submissionId), /cannot be deleted/);
      assert.throws(
        () => db.prepare("UPDATE submission_answers SET answer_text = 'x' WHERE submission_id = ?").run(submissionId),
        /cannot be modified/,
      );
    });

    test('unit and group must belong to the same activity (AC-08)', () => {
      const other = insertActivity(db);
      const outsider = insertGroup(db, other, 'Outsider');
      openActivity(db, activityId);
      assert.throws(() => submit({ groupId: outsider }), /FOREIGN KEY constraint failed/);
    });

    test('answers must reference questions of the submitted unit (FR-08)', () => {
      const group = insertGroupUnit(db, activityId, {
        groupCode: 'G1',
        questions: [{ questionKey: '2' }, { questionKey: '3' }],
      });
      openActivity(db, activityId);
      assert.throws(
        () =>
          submit({
            unitId: group.unitId,
            answers: [{ questionId: single.questionId, text: '繞過題組' }],
          }),
        /FOREIGN KEY constraint failed/,
      );
    });

    test('answer text is stored verbatim, including line breaks', () => {
      openActivity(db, activityId);
      const text = '第一行\n第二行 =1+1 <script>';
      const submissionId = submit({ answers: [{ questionId: single.questionId, text }] });
      const row = db.prepare('SELECT answer_text FROM submission_answers WHERE submission_id = ?').get(submissionId);
      assert.equal(row.answer_text, text);
    });
  });

  describe('results', () => {
    let activityId;
    let unitId;
    let submissionIds;

    beforeEach(() => {
      activityId = insertActivity(db);
      const a = insertGroup(db, activityId, 'A');
      const b = insertGroup(db, activityId, 'B');
      const unit = insertSingleUnit(db, activityId, { questionKey: '1' });
      unitId = unit.unitId;
      openActivity(db, activityId);
      submissionIds = [a, b].map((groupId, index) =>
        insertSubmission(db, {
          activityId,
          unitId,
          groupId,
          acceptSeq: index + 1,
          answers: [{ questionId: unit.questionId, text: `answer ${index}` }],
        }),
      );
    });

    const insertResult = (submissionId, rank, isWinner) =>
      db
        .prepare('INSERT INTO results (submission_id, unit_id, final_rank, is_winner) VALUES (?, ?, ?, ?)')
        .run(submissionId, unitId, rank, isWinner);

    test('can be stored only once the activity is CLOSED (§4)', () => {
      assert.throws(() => insertResult(submissionIds[0], 1, 1), /only when the activity is CLOSED/);
      closeActivity(db, activityId);
      insertResult(submissionIds[0], 1, 1);
      insertResult(submissionIds[1], 2, 0);
    });

    test('exactly the rank-1 submission is the winner; ranks are unique per unit', () => {
      closeActivity(db, activityId);
      assert.throws(() => insertResult(submissionIds[0], 2, 1), /CHECK constraint failed/);
      insertResult(submissionIds[0], 1, 1);
      assert.throws(() => insertResult(submissionIds[1], 1, 1), /UNIQUE constraint failed/);
    });

    test('are immutable once stored (FR-06)', () => {
      closeActivity(db, activityId);
      insertResult(submissionIds[0], 1, 1);
      assert.throws(
        () => db.prepare('UPDATE results SET final_rank = 3 WHERE submission_id = ?').run(submissionIds[0]),
        /cannot be modified/,
      );
      assert.throws(
        () => db.prepare('DELETE FROM results WHERE submission_id = ?').run(submissionIds[0]),
        /cannot be deleted/,
      );
    });
  });
});
