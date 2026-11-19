import { createHash } from 'node:crypto';
import { withTransaction } from '../../db/transaction.js';
import { conflict } from '../../lib/errors.js';
import { getActivity } from '../activity-groups/activities.js';
import { cellAddress } from './parser.js';

const ORDERED_QUESTIONS = `
  FROM units AS u JOIN questions AS q ON q.unit_id = u.id
  WHERE u.activity_id = ? ORDER BY u.position, q.position_in_unit
`;

export function requirePreparing(db, activityId) {
  if (getActivity(db, activityId).status !== 'PREPARING') {
    throw conflict('INVALID_PHASE', '只有準備中的活動可以匯入試算表。');
  }
}

export function listQuestionUnits(db, activityId) {
  const rows = db.prepare(`
    SELECT u.id AS unitId, u.kind, q.id, q.question_key AS key
    ${ORDERED_QUESTIONS}
  `).all(activityId);
  const units = new Map();
  for (const { unitId, kind, id, key } of rows) {
    if (!units.has(unitId)) units.set(unitId, { id: unitId, kind, questions: [] });
    units.get(unitId).questions.push({ id, key });
  }
  return [...units.values()];
}

export function readImport(db, activityId) {
  const rows = db.prepare(`
    SELECT u.id AS unitId, u.kind, u.group_code AS groupCode, u.position AS unitPosition,
           q.question_key AS key, q.position, q.position_in_unit AS positionInUnit,
           q.spreadsheet_id AS spreadsheetId, q.sheet_id AS sheetId, q.sheet_title AS sheetTitle,
           q.row_index AS rowIndex, q.column_index AS columnIndex, q.original_marker AS originalMarker
    ${ORDERED_QUESTIONS}
  `).all(activityId);
  if (rows.length === 0) return null;

  const units = new Map();
  for (const { unitId, kind, groupCode, unitPosition, spreadsheetId, ...question } of rows) {
    if (!units.has(unitId)) units.set(unitId, { kind, groupCode, position: unitPosition, questions: [] });
    question.cell = cellAddress(question.rowIndex, question.columnIndex);
    units.get(unitId).questions.push(question);
  }
  return { spreadsheetId: rows[0].spreadsheetId, questionCount: rows.length, unitCount: units.size, units: [...units.values()] };
}

export function confirmedImportSnapshot(db, activityId) {
  const imported = readImport(db, activityId);
  const importRevision = createHash('sha256').update(JSON.stringify(imported)).digest('base64url');
  return { imported, importRevision };
}

export function replaceImport(db, activityId, { spreadsheetId, units }) {
  withTransaction(db, () => {
    requirePreparing(db, activityId);
    db.prepare('DELETE FROM units WHERE activity_id = ?').run(activityId);
    const insertUnit = db.prepare('INSERT INTO units (activity_id, kind, group_code, position) VALUES (?, ?, ?, ?)');
    const insertQuestion = db.prepare(`
      INSERT INTO questions (
        activity_id, unit_id, question_key, position, position_in_unit, spreadsheet_id, sheet_id,
        sheet_title, row_index, column_index, original_marker
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const unit of units) {
      const { lastInsertRowid: unitId } = insertUnit.run(activityId, unit.kind, unit.groupCode, unit.position);
      for (const q of unit.questions) {
        insertQuestion.run(activityId, unitId, q.key, q.position, q.positionInUnit, spreadsheetId, q.sheetId,
          q.sheetTitle, q.rowIndex, q.columnIndex, q.originalMarker);
      }
    }
  });
}
