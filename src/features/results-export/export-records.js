import { withTransaction } from '../../db/transaction.js';
import { nowIso } from '../../lib/time.js';
import { cellAddress } from '../sheets-import/parser.js';

/**
 * Per-question write-back records (sheet_exports, sheet_export_items; data-model.md).
 * Each function is a short synchronous transaction: the exporter never holds a transaction
 * while it waits for Google (constitution III).
 */

/** Marks a run that can no longer finish (e.g. the server restarted) as pending verification. */
function settleRun(db, clock, exportId, errorCode) {
  db.prepare("UPDATE sheet_export_items SET status = 'UNKNOWN', reason = ? WHERE export_id = ? AND status = 'PENDING'")
    .run(errorCode, exportId);
  db.prepare("UPDATE sheet_exports SET outcome = 'UNKNOWN', error_code = ?, finished_at = ? WHERE id = ?")
    .run(errorCode, nowIso(clock), exportId);
}

function settleInterrupted(db, clock, activityId) {
  for (const { id } of db.prepare("SELECT id FROM sheet_exports WHERE activity_id = ? AND outcome = 'RUNNING'").all(activityId)) {
    settleRun(db, clock, id, 'INTERRUPTED');
  }
}

/** Starts a run. The caller holds the activity's in-process lock, so any RUNNING row is stale. */
export function startRun(db, clock, activityId) {
  return withTransaction(db, () => {
    settleInterrupted(db, clock, activityId);
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO sheet_exports (activity_id, started_at, outcome) VALUES (?, ?, 'RUNNING')",
    ).run(activityId, nowIso(clock));
    return Number(lastInsertRowid);
  });
}

/** @param {Array<{ questionId, spreadsheetId, sheetId, sheetTitle, rowIndex, columnIndex, content, status, reason? }>} items */
export function recordItems(db, exportId, items) {
  withTransaction(db, () => {
    const insert = db.prepare(`
      INSERT INTO sheet_export_items (
        export_id, question_id, spreadsheet_id, sheet_id, sheet_title, row_index, column_index, content, status, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of items) {
      insert.run(exportId, item.questionId, item.spreadsheetId, item.sheetId, item.sheetTitle, item.rowIndex,
        item.columnIndex, item.content, item.status, item.reason ?? null);
    }
  });
}

/** @param {Array<{ questionId, status, reason? }>} updates */
export function updateItems(db, exportId, updates) {
  withTransaction(db, () => {
    const update = db.prepare('UPDATE sheet_export_items SET status = ?, reason = ? WHERE export_id = ? AND question_id = ?');
    for (const { questionId, status, reason } of updates) update.run(status, reason ?? null, exportId, questionId);
  });
}

export function finishRun(db, clock, exportId, outcome, errorCode = null) {
  withTransaction(db, () => {
    db.prepare('UPDATE sheet_exports SET outcome = ?, error_code = ?, finished_at = ? WHERE id = ?')
      .run(outcome, errorCode, nowIso(clock), exportId);
  });
}

/** Abandons a run after an unexpected error; any answer that may have been sent becomes UNKNOWN. */
export function abandonRun(db, clock, exportId, errorCode) {
  withTransaction(db, () => settleRun(db, clock, exportId, errorCode));
}

export function readExport(db, exportId) {
  const run = db.prepare(`
    SELECT id, outcome, started_at AS startedAt, finished_at AS finishedAt, error_code AS errorCode
    FROM sheet_exports WHERE id = ?
  `).get(exportId);
  const items = db.prepare(`
    SELECT q.question_key AS questionKey,
           CASE u.kind WHEN 'GROUP' THEN 'G:' || u.group_code ELSE 'Q:' || q.question_key END AS unitLabel,
           g.name AS groupName, i.content, i.sheet_id AS sheetId, i.sheet_title AS sheetTitle,
           i.row_index AS rowIndex, i.column_index AS columnIndex, i.status, i.reason
    FROM sheet_export_items AS i
    JOIN questions AS q ON q.id = i.question_id
    JOIN units AS u ON u.id = q.unit_id
    LEFT JOIN results AS r ON r.unit_id = u.id AND r.is_winner = 1
    LEFT JOIN submissions AS s ON s.id = r.submission_id
    LEFT JOIN student_groups AS g ON g.id = s.group_id
    WHERE i.export_id = ?
    ORDER BY u.position, q.position_in_unit
  `).all(exportId);
  return {
    ...run,
    items: items.map(({ sheetId, sheetTitle, rowIndex, columnIndex, reason, ...item }) => ({
      ...item, target: { sheetId, sheetTitle, cell: cellAddress(rowIndex, columnIndex) }, reason,
    })),
  };
}

/** The latest run of an activity; a RUNNING row that no live run owns is settled first. */
export function latestExport(db, clock, activityId, isActive) {
  if (!isActive(activityId)) withTransaction(db, () => settleInterrupted(db, clock, activityId));
  const latest = db.prepare('SELECT id FROM sheet_exports WHERE activity_id = ? ORDER BY id DESC LIMIT 1').get(activityId);
  return latest ? readExport(db, latest.id) : null;
}
