import { AppError, badRequest, conflict } from '../../lib/errors.js';
import { getActivity } from '../activity-groups/activities.js';
import { cellAddress } from '../sheets-import/parser.js';
import {
  abandonRun, finishRun, latestExport, readExport, recordItems, startRun, updateItems,
} from './export-records.js';
import { listWinningAnswers } from './results.js';

// Google answered with these errors, so the batch was not applied (research R8).
const NOT_APPLIED = new Set([
  'SHEETS_PERMISSION', 'SHEETS_NOT_FOUND', 'SHEETS_QUOTA', 'SHEETS_CREDENTIALS', 'SHEETS_AUTH', 'INVALID_SPREADSHEET',
]);

const DESCRIPTIONS = Object.freeze({
  SHEET_MISSING: '工作表已不存在。',
  OUT_OF_RANGE: '格位已超出工作表範圍，列或欄可能已被刪除。',
  MERGED: '目標格已被合併。',
  CHANGED: '目標格已不是匯入時的標記，可能被移動、改寫或插入了列欄。',
  READBACK_MISMATCH: '寫入後回讀的內容不一致，可能有人同時在編輯。',
  NOT_APPLIED: 'Google 沒有套用寫入，格子仍是原標記。',
  READBACK_FAILED: '寫入後無法回讀，無法確定是否已寫入。',
  INTERRUPTED: '寫回中途中斷（例如伺服器重新啟動），無法確定是否已寫入。',
  INTERNAL_ERROR: '伺服器發生錯誤，無法確定是否已寫入。',
  SHEETS_CREDENTIALS: '無法載入服務帳戶憑證，請檢查 GOOGLE_APPLICATION_CREDENTIALS 設定。',
  SHEETS_AUTH: 'Google 拒絕服務帳戶驗證，請確認金鑰有效。',
  SHEETS_PERMISSION: '服務帳戶無法存取試算表，請確認已共用編輯權限並啟用 Sheets API。',
  SHEETS_NOT_FOUND: 'Google 找不到試算表，請確認試算表仍存在且服務帳戶有權存取。',
  SHEETS_QUOTA: 'Google Sheets API 配額或呼叫頻率已達上限，請稍後再試。',
  SHEETS_TIMEOUT: '連線 Google 逾時。',
  SHEETS_NETWORK: '無法連線 Google，請檢查網路。',
  SHEETS_API: 'Google Sheets API 無法完成要求。',
  SHEETS_BAD_RESPONSE: 'Google 回傳的資料格式無效。',
  INVALID_SPREADSHEET: '匯入時的試算表 ID 無效。',
});

const describe = (code) => DESCRIPTIONS[code] ?? `寫回未完成（${code}）。`;
const codeOf = (error) => (error instanceof AppError ? error.code : 'INTERNAL_ERROR');
const normalizeLines = (text) => text.replace(/\r\n?/g, '\n');
const cellOf = ({ sheetId, rowIndex, columnIndex }) => ({ sheetId, rowIndex, columnIndex });

const PREVIEW_STATUSES = ['READY', 'ALREADY_PRESENT', 'CONFLICT', 'NO_ANSWER'];
const RECORD_STATUSES = ['WRITTEN', 'ALREADY_PRESENT', 'CONFLICT', 'SKIPPED', 'FAILED', 'UNKNOWN', 'PENDING'];

function countStatuses(items, statuses) {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const { status } of items) counts[status] += 1;
  return counts;
}

function covers(range, { rowIndex, columnIndex }) {
  return rowIndex >= (range.startRowIndex ?? 0) && rowIndex < range.endRowIndex &&
    columnIndex >= (range.startColumnIndex ?? 0) && columnIndex < range.endColumnIndex;
}

/**
 * Decides whether a target cell may be written (research R6). Only the original marker
 * (compared after trimming, like SF-02's parser) or the same answer already written passes;
 * anything else is a conflict and the old coordinates must not be used.
 */
export function classifyTarget(target, { sheet, value }) {
  if (!sheet) return { status: 'CONFLICT', reason: 'SHEET_MISSING' };
  if (target.rowIndex >= sheet.rowCount || target.columnIndex >= sheet.columnCount) {
    return { status: 'CONFLICT', reason: 'OUT_OF_RANGE' };
  }
  if (sheet.merges.some((range) => covers(range, target))) return { status: 'CONFLICT', reason: 'MERGED' };
  const text = value?.stringValue;
  if (typeof text === 'string') {
    if (normalizeLines(text) === normalizeLines(target.content)) return { status: 'ALREADY_PRESENT' };
    if (text.trim() === target.originalMarker.trim()) return { status: 'READY' };
  }
  return { status: 'CONFLICT', reason: 'CHANGED' };
}

function outcomeOf(statuses) {
  if (statuses.every((status) => status === 'WRITTEN' || status === 'ALREADY_PRESENT')) return 'SUCCEEDED';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  if (statuses.includes('CONFLICT')) return 'CONFLICT';
  return 'FAILED';
}

/** Interprets a cell read back after a write attempt. */
function settle(target, observed, writeError) {
  const { status, reason } = classifyTarget(target, observed);
  if (status === 'ALREADY_PRESENT') return { questionId: target.questionId, status: 'WRITTEN', reason: null };
  if (status === 'READY') {
    return { questionId: target.questionId, status: 'FAILED', reason: writeError ? codeOf(writeError) : 'NOT_APPLIED' };
  }
  return { questionId: target.questionId, status: 'CONFLICT', reason: reason === 'CHANGED' ? 'READBACK_MISMATCH' : reason };
}

const itemRecord = (target, status, reason = null, currentTitle = undefined) => ({
  questionId: target.questionId, spreadsheetId: target.spreadsheetId, sheetId: target.sheetId,
  sheetTitle: currentTitle ?? target.sheetTitle, rowIndex: target.rowIndex, columnIndex: target.columnIndex,
  content: target.content, status, reason,
});

function present(record) {
  if (!record) return null;
  const { errorCode, items, ...run } = record;
  const described = items.map((item) => ({ ...item, reasonText: item.reason ? describe(item.reason) : null }));
  return {
    ...run,
    error: errorCode ? { code: errorCode, message: describe(errorCode) } : null,
    items: described,
    counts: countStatuses(described, RECORD_STATUSES),
  };
}

/**
 * Previews and performs the write-back of winning answers to the original spreadsheet
 * (FR-07; sequence diagram 004-results-export-sequence-writeback). Write-backs of one
 * activity are mutually exclusive within this process; the database index is the backstop.
 */
export function createSheetsExporter({ db, clock, sheetsGateway: gateway }) {
  const running = new Set();
  const isActive = (activityId) => running.has(activityId);

  function plan(activityId) {
    const questions = listWinningAnswers(db, activityId);
    return {
      spreadsheetId: questions[0]?.spreadsheetId ?? null,
      questions,
      targets: questions.filter(({ content }) => content !== null),
    };
  }

  async function preview(activityId) {
    const { spreadsheetId, questions, targets } = plan(activityId);
    const observed = targets.length ? await gateway.readTargets(spreadsheetId, targets.map(cellOf)) : [];
    const verdicts = new Map(targets.map((target, index) => [
      target.questionId, { ...classifyTarget(target, observed[index]), title: observed[index].sheet?.title },
    ]));
    const items = questions.map((question) => {
      const verdict = verdicts.get(question.questionId);
      const reason = verdict?.reason ?? null;
      return {
        questionKey: question.questionKey, unitLabel: question.unitLabel,
        groupName: question.groupName, content: question.content,
        target: {
          sheetId: question.sheetId, sheetTitle: verdict?.title ?? question.sheetTitle,
          cell: cellAddress(question.rowIndex, question.columnIndex),
        },
        status: verdict?.status ?? 'NO_ANSWER', reason, reasonText: reason ? describe(reason) : null,
      };
    });
    return { spreadsheetId, items, counts: countStatuses(items, PREVIEW_STATUSES) };
  }

  async function writeBack(exportId, spreadsheetId, targets) {
    let observed;
    try {
      observed = await gateway.readTargets(spreadsheetId, targets.map(cellOf));
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      recordItems(db, exportId, targets.map((target) => itemRecord(target, 'FAILED', error.code)));
      finishRun(db, clock, exportId, 'FAILED', error.code);
      return;
    }

    const verdicts = targets.map((target, index) => ({
      target, ...classifyTarget(target, observed[index]), title: observed[index].sheet?.title,
    }));
    if (verdicts.some(({ status }) => status === 'CONFLICT')) {
      // Stop the whole batch: every marker stays in place for a restore or a new import (research R7).
      recordItems(db, exportId, verdicts.map(({ target, status, reason, title }) => (
        itemRecord(target, status === 'READY' ? 'SKIPPED' : status, reason, title))));
      finishRun(db, clock, exportId, 'CONFLICT');
      return;
    }
    recordItems(db, exportId, verdicts.map(({ target, status, title }) => (
      itemRecord(target, status === 'READY' ? 'PENDING' : status, null, title))));
    const pending = verdicts.filter(({ status }) => status === 'READY').map(({ target }) => target);
    if (pending.length === 0) {
      finishRun(db, clock, exportId, 'SUCCEEDED');
      return;
    }

    let writeError = null;
    try {
      await gateway.writeCells(spreadsheetId, pending.map((target) => ({ ...cellOf(target), text: target.content })));
    } catch (error) {
      writeError = error;
    }
    if (writeError && NOT_APPLIED.has(codeOf(writeError))) {
      updateItems(db, exportId, pending.map(({ questionId }) => ({ questionId, status: 'FAILED', reason: codeOf(writeError) })));
      finishRun(db, clock, exportId, 'FAILED', codeOf(writeError));
      return;
    }

    // Only a cell read back with the same content counts as written (FR-014).
    let readBack = null;
    try {
      readBack = await gateway.readTargets(spreadsheetId, pending.map(cellOf));
    } catch {
      readBack = null;
    }
    if (!readBack) {
      const reason = writeError ? codeOf(writeError) : 'READBACK_FAILED';
      updateItems(db, exportId, pending.map(({ questionId }) => ({ questionId, status: 'UNKNOWN', reason })));
      finishRun(db, clock, exportId, 'UNKNOWN', reason);
      return;
    }
    const settled = pending.map((target, index) => settle(target, readBack[index], writeError));
    updateItems(db, exportId, settled);
    const outcome = outcomeOf([
      ...verdicts.filter(({ status }) => status === 'ALREADY_PRESENT').map(({ status }) => status),
      ...settled.map(({ status }) => status),
    ]);
    const errorCode = outcome === 'SUCCEEDED' ? null : (writeError ? codeOf(writeError) : (outcome === 'FAILED' ? 'NOT_APPLIED' : null));
    finishRun(db, clock, exportId, outcome, errorCode);
  }

  async function run(activityId, { editsPaused } = {}) {
    const { spreadsheetId, targets } = plan(activityId);
    if (editsPaused !== true) throw badRequest('EDITS_PAUSE_REQUIRED', '請先確認已請其他人暫停編輯這份試算表。');
    if (targets.length === 0) throw conflict('NOTHING_TO_EXPORT', '沒有需要寫回的勝出答案。');
    if (running.has(activityId)) {
      throw conflict('EXPORT_IN_PROGRESS', '這場活動正在寫回試算表，請等待目前的寫回完成。');
    }
    running.add(activityId);
    try {
      const exportId = startRun(db, clock, activityId);
      try {
        await writeBack(exportId, spreadsheetId, targets);
      } catch (error) {
        abandonRun(db, clock, exportId, 'INTERNAL_ERROR');
        throw error;
      }
      return present(readExport(db, exportId));
    } finally {
      running.delete(activityId);
    }
  }

  function latest(activityId) {
    getActivity(db, activityId);
    return present(latestExport(db, clock, activityId, isActive));
  }

  return { preview, run, latest };
}
