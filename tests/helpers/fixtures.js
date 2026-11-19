/**
 * Test fixtures that insert rows directly, bypassing feature services. They let each
 * sub-feature write tests against the shared schema before other features are merged.
 * Production code must go through the owning feature's services instead.
 */

const T0 = '2026-01-01T00:00:00.000Z';
let sequence = 0;

/** @returns {string} activity id */
export function insertActivity(db, { id, joinCode, mode = 'SPEED', createdAt = T0 } = {}) {
  sequence += 1;
  const activityId = id ?? `activity-${sequence}`;
  db.prepare('INSERT INTO activities (id, join_code, mode, created_at) VALUES (?, ?, ?, ?)').run(
    activityId,
    joinCode ?? `JOIN${sequence}`,
    mode,
    createdAt,
  );
  return activityId;
}

export function openActivity(db, activityId, openedAt = T0) {
  db.prepare("UPDATE activities SET status = 'OPEN', opened_at = ? WHERE id = ?").run(openedAt, activityId);
}

export function closeActivity(db, activityId, closedAt = T0) {
  db.prepare("UPDATE activities SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(closedAt, activityId);
}

/** @returns {number} group id */
export function insertGroup(db, activityId, name, { createdAt = T0 } = {}) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO student_groups (activity_id, name, created_at) VALUES (?, ?, ?)')
    .run(activityId, name, createdAt);
  return Number(lastInsertRowid);
}

/**
 * Inserts a single-question unit ({{Q:<questionKey>}}).
 * @returns {{ unitId: number, questionId: number }}
 */
export function insertSingleUnit(db, activityId, { questionKey, cell } = {}) {
  const unitId = insertUnit(db, activityId, 'SINGLE', null);
  const [questionId] = insertQuestions(db, activityId, unitId, [{ questionKey, cell }]);
  return { unitId, questionId };
}

/**
 * Inserts a question-group unit ({{Q:<key>|G:<groupCode>}} for every member).
 * @param {{ groupCode: string, questions: Array<{ questionKey: string, cell?: object }> }} options
 * @returns {{ unitId: number, questionIds: number[] }}
 */
export function insertGroupUnit(db, activityId, { groupCode, questions }) {
  const unitId = insertUnit(db, activityId, 'GROUP', groupCode);
  const questionIds = insertQuestions(db, activityId, unitId, questions, groupCode);
  return { unitId, questionIds };
}

/**
 * Inserts an accepted submission and its answers. The activity must be OPEN.
 * @param {{ activityId: string, unitId: number, groupId: number, acceptSeq: number,
 *   acceptedAt?: string, answers: Array<{ questionId: number, text: string }> }} submission
 * @returns {number} submission id
 */
export function insertSubmission(db, { activityId, unitId, groupId, acceptSeq, acceptedAt = T0, answers }) {
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO submissions (activity_id, unit_id, group_id, accept_seq, accepted_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(activityId, unitId, groupId, acceptSeq, acceptedAt);
  const submissionId = Number(lastInsertRowid);
  const insertAnswer = db.prepare(
    'INSERT INTO submission_answers (submission_id, unit_id, question_id, answer_text) VALUES (?, ?, ?, ?)',
  );
  for (const { questionId, text } of answers) insertAnswer.run(submissionId, unitId, questionId, text);
  return submissionId;
}

function insertUnit(db, activityId, kind, groupCode) {
  const position = nextValue(db, 'SELECT MAX(position) AS value FROM units WHERE activity_id = ?', activityId);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO units (activity_id, kind, group_code, position) VALUES (?, ?, ?, ?)')
    .run(activityId, kind, groupCode, position);
  return Number(lastInsertRowid);
}

function insertQuestions(db, activityId, unitId, questions, groupCode = null) {
  const insert = db.prepare(`
    INSERT INTO questions (
      activity_id, unit_id, question_key, position, position_in_unit,
      spreadsheet_id, sheet_id, sheet_title, row_index, column_index, original_marker
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return questions.map(({ questionKey, cell = {} }, index) => {
    const position = nextValue(db, 'SELECT MAX(position) AS value FROM questions WHERE activity_id = ?', activityId);
    const marker = groupCode ? `{{Q:${questionKey}|G:${groupCode}}}` : `{{Q:${questionKey}}}`;
    const { lastInsertRowid } = insert.run(
      activityId,
      unitId,
      questionKey,
      position,
      index + 1,
      cell.spreadsheetId ?? 'test-spreadsheet',
      cell.sheetId ?? 0,
      cell.sheetTitle ?? 'Sheet1',
      cell.row ?? position,
      cell.column ?? 1,
      marker,
    );
    return Number(lastInsertRowid);
  });
}

function nextValue(db, sql, activityId) {
  return (db.prepare(sql).get(activityId).value ?? 0) + 1;
}
