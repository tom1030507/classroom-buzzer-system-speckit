import { conflict } from '../../lib/errors.js';
import { getActivity } from '../activity-groups/activities.js';
import { RANKERS } from './ranking.js';

/**
 * Saves the final rank of every accepted submission. Call it inside the transaction that
 * moves the activity to CLOSED, so the status and the complete results commit together
 * (spec.md §4). It neither opens a transaction nor awaits.
 */
export function saveFinalResults(db, activityId, mode) {
  const rank = RANKERS[mode];
  if (!rank) throw conflict('RANKING_UNAVAILABLE', '這個模式的結果計算尚未提供，無法結束活動。');
  const insert = db.prepare('INSERT INTO results (submission_id, unit_id, final_rank, is_winner) VALUES (?, ?, ?, ?)');
  for (const { submissionId, unitId, finalRank } of rank(rankingUnits(db, activityId))) {
    insert.run(submissionId, unitId, finalRank, finalRank === 1 ? 1 : 0);
  }
}

function rankingUnits(db, activityId) {
  const rows = db.prepare(`
    SELECT u.id AS unitId, s.id AS submissionId, s.group_id AS groupId, s.accept_seq AS acceptSeq
    FROM units AS u LEFT JOIN submissions AS s ON s.unit_id = u.id
    WHERE u.activity_id = ?
    ORDER BY u.position, s.accept_seq
  `).all(activityId);
  const units = new Map();
  for (const { unitId, submissionId, groupId, acceptSeq } of rows) {
    if (!units.has(unitId)) units.set(unitId, { unitId, submissions: [] });
    if (submissionId !== null) units.get(unitId).submissions.push({ submissionId, groupId, acceptSeq });
  }
  return [...units.values()];
}

/**
 * Every imported question with its target cell and, when its unit has a winner, the winning
 * group and answer (null when nobody answered). Group members each keep their own cell.
 */
export function listWinningAnswers(db, activityId) {
  const { id, status } = getActivity(db, activityId);
  if (status !== 'CLOSED') throw conflict('INVALID_PHASE', '活動結束後才能寫回試算表。');
  const unranked = db.prepare(`
    SELECT 1 FROM submissions AS s LEFT JOIN results AS r ON r.submission_id = s.id
    WHERE s.activity_id = ? AND r.submission_id IS NULL LIMIT 1
  `).get(id);
  if (unranked) throw conflict('RESULTS_UNAVAILABLE', '這場活動沒有保存結果。');
  return db.prepare(`
    SELECT q.id AS questionId, q.question_key AS questionKey,
           CASE u.kind WHEN 'GROUP' THEN 'G:' || u.group_code ELSE 'Q:' || q.question_key END AS unitLabel,
           q.spreadsheet_id AS spreadsheetId, q.sheet_id AS sheetId, q.sheet_title AS sheetTitle,
           q.row_index AS rowIndex, q.column_index AS columnIndex, q.original_marker AS originalMarker,
           g.name AS groupName, a.answer_text AS content
    FROM questions AS q
    JOIN units AS u ON u.id = q.unit_id
    LEFT JOIN results AS r ON r.unit_id = u.id AND r.is_winner = 1
    LEFT JOIN submissions AS s ON s.id = r.submission_id
    LEFT JOIN student_groups AS g ON g.id = s.group_id
    LEFT JOIN submission_answers AS a ON a.submission_id = s.id AND a.question_id = q.id
    WHERE q.activity_id = ?
    ORDER BY u.position, q.position_in_unit
  `).all(id);
}

/**
 * The fixed results shared by the result pages, the CSV and the Sheets write-back
 * (specs/004-results-export/data-model.md). Contains no internal group ids; acceptedOrder is the
 * server's acceptance sequence across the whole activity (FR-025).
 */
export function readResults(db, activityId) {
  const { id, mode, status } = getActivity(db, activityId);
  if (status !== 'CLOSED') throw conflict('INVALID_PHASE', '活動結束後才能查看結果。');
  const { closedAt } = db.prepare('SELECT closed_at AS closedAt FROM activities WHERE id = ?').get(id);

  const units = new Map();
  for (const row of db.prepare(`
    SELECT u.id, u.kind, u.group_code AS groupCode, u.position, q.question_key AS questionKey
    FROM units AS u JOIN questions AS q ON q.unit_id = u.id
    WHERE u.activity_id = ? ORDER BY u.position, q.position_in_unit
  `).all(id)) {
    if (!units.has(row.id)) {
      const label = row.kind === 'GROUP' ? `G:${row.groupCode}` : `Q:${row.questionKey}`;
      units.set(row.id, { id: row.id, kind: row.kind, label, position: row.position, questions: [], entries: [] });
    }
    units.get(row.id).questions.push({ key: row.questionKey });
  }

  const entries = new Map();
  for (const row of db.prepare(`
    SELECT s.id AS submissionId, s.unit_id AS unitId, g.name AS groupName, s.accepted_at AS acceptedAt,
           s.accept_seq AS acceptedOrder,
           r.final_rank AS rank, r.is_winner AS isWinner
    FROM submissions AS s
    JOIN student_groups AS g ON g.id = s.group_id
    LEFT JOIN results AS r ON r.submission_id = s.id
    WHERE s.activity_id = ?
  `).all(id)) {
    if (row.rank === null) throw conflict('RESULTS_UNAVAILABLE', '這場活動沒有保存結果。');
    const entry = {
      groupName: row.groupName, acceptedOrder: row.acceptedOrder, acceptedAt: row.acceptedAt,
      rank: row.rank, isWinner: row.isWinner === 1, answers: [],
    };
    entries.set(row.submissionId, entry);
    units.get(row.unitId).entries.push(entry);
  }

  for (const { submissionId, questionKey, text } of db.prepare(`
    SELECT a.submission_id AS submissionId, q.question_key AS questionKey, a.answer_text AS text
    FROM submission_answers AS a
    JOIN submissions AS s ON s.id = a.submission_id
    JOIN questions AS q ON q.id = a.question_id
    WHERE s.activity_id = ? ORDER BY q.position_in_unit
  `).all(id)) {
    entries.get(submissionId).answers.push({ questionKey, text });
  }

  return {
    activity: { id, mode, status, closedAt },
    units: [...units.values()].map(({ entries: unitEntries, ...unit }) => ({
      ...unit,
      noAnswer: unitEntries.length === 0,
      entries: unitEntries.sort((a, b) => a.rank - b.rank),
    })),
  };
}
