import { withTransaction } from '../../db/transaction.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';
import { getGroupSession } from '../activity-groups/sessions.js';

const MAX_ANSWER_LENGTH = 1000;
const ONLY_WHITESPACE = /^[\p{White_Space}\uFEFF]*$/u;

function invalidAnswers() {
  return badRequest('INVALID_ANSWERS', '請提交本單位的所有題目，每題須有 1 到 1,000 個字元的有效答案。');
}

function normalizeAnswers(body, questions) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalidAnswers();
  if (Object.hasOwn(body, 'groupId') || Object.hasOwn(body, 'activityId') || Object.hasOwn(body, 'role')) {
    throw forbidden('INVALID_GROUP', '組別身分由目前的工作階段決定。');
  }
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'answers') ||
      !Array.isArray(body.answers) || body.answers.length !== questions.length) {
    throw invalidAnswers();
  }

  const accepted = new Map(questions.map(({ questionKey }) => [questionKey, null]));
  for (const answer of body.answers) {
    if (!answer || typeof answer !== 'object' || Array.isArray(answer) || Object.keys(answer).length !== 2 ||
        !Object.hasOwn(answer, 'questionKey') || !Object.hasOwn(answer, 'text')) {
      throw invalidAnswers();
    }
    const { questionKey, text } = answer;
    if (!accepted.has(questionKey)) {
      throw badRequest('INVALID_QUESTION', '有題號不屬於這個作答單位。');
    }
    if (accepted.get(questionKey) !== null || typeof text !== 'string' || !text.isWellFormed() ||
        ONLY_WHITESPACE.test(text) || [...text].length > MAX_ANSWER_LENGTH) {
      throw invalidAnswers();
    }
    accepted.set(questionKey, text);
  }
  return questions.map(({ id, questionKey }) => ({ id, text: accepted.get(questionKey) }));
}

function getUnitQuestions(db, activityId, unitIdParam) {
  const unitId = /^[1-9]\d*$/.test(unitIdParam) ? Number(unitIdParam) : NaN;
  if (Number.isSafeInteger(unitId)) {
    const questions = db.prepare(`
      SELECT id, question_key AS questionKey
      FROM questions WHERE activity_id = ? AND unit_id = ? ORDER BY position_in_unit
    `).all(activityId, unitId);
    if (questions.length) return { unitId, questions };
  }
  throw notFound('INVALID_UNIT', '找不到這個作答單位。');
}

export function submissionBodyLimit(db, activityId, unitId) {
  const { questions } = getUnitQuestions(db, activityId, unitId);
  // Escaping an astral code point in JSON needs 12 bytes (two Unicode escapes).
  return questions.reduce((bytes, { questionKey }) => (
    bytes + MAX_ANSWER_LENGTH * 12 + questionKey.length * 6 + 112
  ), 4096);
}

/** Validates and records one single-question or grouped submission in server order. */
export function acceptSubmission(deps, req) {
  const { db, clock } = deps;
  return withTransaction(db, () => {
    const session = getGroupSession(deps, req);
    if (!session) throw unauthorized('GROUP_REQUIRED', '請先加入活動。');
    if (session.status !== 'OPEN') throw conflict('INVALID_PHASE', '目前無法送出答案。');

    const { activityId, groupId } = session;
    const { unitId, questions } = getUnitQuestions(db, activityId, req.params.unitId);
    const answers = normalizeAnswers(req.body, questions);
    const [existing] = loadSubmissions(db, activityId, { groupId, unitId });
    if (existing) return { created: false, receipt: toReceipt(existing) };

    const { nextSequence } = db.prepare(`
      SELECT COALESCE(MAX(accept_seq), 0) + 1 AS nextSequence FROM submissions WHERE activity_id = ?
    `).get(activityId);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO submissions (activity_id, unit_id, group_id, accept_seq, accepted_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(activityId, unitId, groupId, nextSequence, nowIso(clock));
    const insertAnswer = db.prepare(`
      INSERT INTO submission_answers (submission_id, unit_id, question_id, answer_text) VALUES (?, ?, ?, ?)
    `);
    for (const { id, text } of answers) insertAnswer.run(lastInsertRowid, unitId, id, text);

    const [accepted] = loadSubmissions(db, activityId, { groupId, unitId });
    return { created: true, receipt: toReceipt(accepted) };
  });
}

export function listOwnReceipts(db, { activityId, groupId }) {
  const records = loadSubmissions(db, activityId, { groupId });
  return new Map(records.map((record) => [record.unitId, toReceipt(record)]));
}

export function listSubmissions(db, activityId) {
  return loadSubmissions(db, activityId).map(({ unitId, groupId, acceptedAt, acceptSeq, answers }) => ({
    unitId, groupId, acceptedAt, acceptSeq, answers,
  }));
}

function toReceipt({ receiptId, unitId, acceptedAt, answers }) {
  return { id: receiptId, unitId, acceptedAt, answers };
}

function loadSubmissions(db, activityId, { groupId, unitId } = {}) {
  const filters = ['s.activity_id = ?'];
  const params = [activityId];
  if (groupId !== undefined) {
    filters.push('s.group_id = ?');
    params.push(groupId);
  }
  if (unitId !== undefined) {
    filters.push('s.unit_id = ?');
    params.push(unitId);
  }
  const rows = db.prepare(`
    SELECT s.id, s.unit_id AS unitId, s.group_id AS groupId, s.accepted_at AS acceptedAt,
           s.accept_seq AS acceptSeq, r.receipt_id AS receiptId, q.question_key AS questionKey,
           a.answer_text AS text
    FROM submissions AS s
    JOIN submission_receipts AS r ON r.submission_id = s.id
    LEFT JOIN submission_answers AS a ON a.submission_id = s.id
    LEFT JOIN questions AS q ON q.id = a.question_id
    WHERE ${filters.join(' AND ')}
    ORDER BY s.accept_seq, q.position_in_unit
  `).all(...params);

  const records = new Map();
  for (const { id, questionKey, text, ...submission } of rows) {
    if (!records.has(id)) records.set(id, { ...submission, answers: [] });
    if (questionKey !== null) records.get(id).answers.push({ questionKey, text });
  }
  return [...records.values()];
}
