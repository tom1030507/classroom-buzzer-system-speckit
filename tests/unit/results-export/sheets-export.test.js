import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../../../src/db/connection.js';
import { migrate } from '../../../src/db/migrate.js';
import { transitionActivity } from '../../../src/features/realtime-buzzer/state.js';
import { classifyTarget, createSheetsExporter } from '../../../src/features/results-export/sheets-export.js';
import { AppError } from '../../../src/lib/errors.js';
import { createFixedClock } from '../../../src/lib/time.js';
import {
  insertActivity, insertGroup, insertGroupUnit, insertSingleUnit, insertSubmission, openActivity,
} from '../../helpers/fixtures.js';

// ── classifyTarget ─────────────────────────────────────────────────────────────

const sheet = {
  id: 0, title: 'Sheet1', rowCount: 10, columnCount: 5,
  merges: [{ startRowIndex: 6, endRowIndex: 8, startColumnIndex: 1, endColumnIndex: 3 }, { endRowIndex: 1, endColumnIndex: 1 }],
};
const target = { rowIndex: 2, columnIndex: 1, originalMarker: '　{{Q:5}} ', content: '第一行\n第二行' };
const text = (stringValue) => ({ stringValue });
const conflict = (reason) => ({ status: 'CONFLICT', reason });

test('classifyTarget accepts the original marker and recognizes an answer that is already written', () => {
  assert.deepEqual(classifyTarget(target, { sheet, value: text('{{Q:5}}') }), { status: 'READY' });
  assert.deepEqual(classifyTarget(target, { sheet, value: text(' {{Q:5}}　') }), { status: 'READY' });
  assert.deepEqual(classifyTarget(target, { sheet, value: text('第一行\n第二行') }), { status: 'ALREADY_PRESENT' });
  assert.deepEqual(classifyTarget(target, { sheet, value: text('第一行\r\n第二行') }), { status: 'ALREADY_PRESENT' });
  assert.deepEqual(classifyTarget(target, { sheet: { ...sheet, title: '改名後' }, value: text('{{Q:5}}') }), { status: 'READY' });
});

test('classifyTarget reports structural changes and any other content as conflicts', () => {
  assert.deepEqual(classifyTarget(target, { sheet: null, value: null }), conflict('SHEET_MISSING'));
  assert.deepEqual(classifyTarget({ ...target, rowIndex: 10 }, { sheet, value: null }), conflict('OUT_OF_RANGE'));
  assert.deepEqual(classifyTarget({ ...target, columnIndex: 5 }, { sheet, value: null }), conflict('OUT_OF_RANGE'));
  assert.deepEqual(classifyTarget({ ...target, rowIndex: 7, columnIndex: 2 }, { sheet, value: text('{{Q:5}}') }), conflict('MERGED'));
  assert.deepEqual(classifyTarget({ ...target, rowIndex: 0, columnIndex: 0 }, { sheet, value: text('{{Q:5}}') }), conflict('MERGED'));
  for (const value of [null, { numberValue: 5 }, { formulaValue: '=A1' }, text('{{Q:6}}'), text('別人的答案')]) {
    assert.deepEqual(classifyTarget(target, { sheet, value }), conflict('CHANGED'));
  }
});

// ── exporter ───────────────────────────────────────────────────────────────────

const SPREADSHEET = 'spreadsheet-under-test';

/** An in-memory spreadsheet behind the gateway interface, with hooks to inject failures. */
function fakeSpreadsheet() {
  const sheets = new Map([
    [0, { id: 0, title: '單題', rowCount: 20, columnCount: 5, merges: [] }],
    [5, { id: 5, title: '題組', rowCount: 20, columnCount: 5, merges: [] }],
  ]);
  const cells = new Map();
  const key = (sheetId, row, column) => `${sheetId}:${row}:${column}`;
  const log = { reads: 0, writes: [] };
  const hooks = {};
  const gateway = {
    async readTargets(spreadsheetId, targets) {
      assert.equal(spreadsheetId, SPREADSHEET);
      log.reads += 1;
      await hooks.read?.(log.reads);
      return targets.map(({ sheetId, rowIndex, columnIndex }) => {
        const found = sheets.get(sheetId);
        if (!found) return { sheet: null, value: null };
        const inGrid = rowIndex < found.rowCount && columnIndex < found.columnCount;
        return {
          sheet: { ...found, merges: [...found.merges] },
          value: inGrid ? cells.get(key(sheetId, rowIndex, columnIndex)) ?? null : null,
        };
      });
    },
    async writeCells(spreadsheetId, written) {
      assert.equal(spreadsheetId, SPREADSHEET);
      log.writes.push(written);
      const { apply = true, error } = hooks.write?.(written) ?? {};
      if (apply) {
        for (const { sheetId, rowIndex, columnIndex, text: value } of written) {
          cells.set(key(sheetId, rowIndex, columnIndex), { stringValue: value });
        }
      }
      if (error) throw error;
    },
  };
  return {
    sheets, log, hooks, gateway,
    set: (sheetId, row, column, value) => cells.set(key(sheetId, row, column), value),
    text: (sheetId, row, column) => cells.get(key(sheetId, row, column))?.stringValue,
  };
}

/**
 * Question 1 (sheet 0, B2): 甲組 wins with "=1+1". Group A (sheet 5: B3, B4, D5): 乙組 wins.
 * Question 5 (sheet 0, B6): nobody answers.
 */
function writeBackActivity(t, { answered = true, close = true } = {}) {
  const db = openDatabase(':memory:');
  migrate(db);
  t.after(() => db.close());
  const clock = createFixedClock('2026-11-20T09:00:00.000Z');
  const spreadsheet = fakeSpreadsheet();
  const activityId = insertActivity(db);
  const alpha = insertGroup(db, activityId, '甲組');
  const beta = insertGroup(db, activityId, '乙組');
  const at = (sheetId, row, column, sheetTitle) => ({ spreadsheetId: SPREADSHEET, sheetId, sheetTitle, row, column });
  const single = insertSingleUnit(db, activityId, { questionKey: '1', cell: at(0, 1, 1, '單題') });
  const grouped = insertGroupUnit(db, activityId, { groupCode: 'A', questions: [
    { questionKey: '2', cell: at(5, 2, 1, '題組') },
    { questionKey: '3', cell: at(5, 3, 1, '題組') },
    { questionKey: '4', cell: at(5, 4, 3, '題組') },
  ] });
  insertSingleUnit(db, activityId, { questionKey: '5', cell: at(0, 5, 1, '單題') });
  for (const { sheet_id: sheetId, row_index: row, column_index: column, original_marker: marker } of db.prepare(
    'SELECT sheet_id, row_index, column_index, original_marker FROM questions WHERE activity_id = ?',
  ).all(activityId)) {
    spreadsheet.set(sheetId, row, column, { stringValue: marker });
  }
  openActivity(db, activityId);
  if (answered) {
    const [q2, q3, q4] = grouped.questionIds;
    insertSubmission(db, { activityId, unitId: single.unitId, groupId: alpha, acceptSeq: 1,
      answers: [{ questionId: single.questionId, text: '=1+1' }] });
    insertSubmission(db, { activityId, unitId: single.unitId, groupId: beta, acceptSeq: 2,
      answers: [{ questionId: single.questionId, text: '乙組較慢的答案' }] });
    insertSubmission(db, { activityId, unitId: grouped.unitId, groupId: beta, acceptSeq: 3, answers: [
      { questionId: q2, text: '第一行\n第二行' }, { questionId: q3, text: '中文答案' }, { questionId: q4, text: "'單引號開頭" },
    ] });
  }
  if (close) transitionActivity({ db, clock }, activityId, 'CLOSED');
  const exporter = createSheetsExporter({ db, clock, sheetsGateway: spreadsheet.gateway });
  return { db, clock, activityId, spreadsheet, exporter };
}

const statuses = (record) => record.items.map(({ questionKey, status, reason }) => [questionKey, status, reason ?? null]);
const distinct = (record) => [...new Set(record.items.map(({ status, reason }) => (reason ? `${status}:${reason}` : status)))];
const savedResults = (db) => db.prepare('SELECT * FROM results ORDER BY submission_id').all();
const writeBack = (exporter, activityId) => exporter.run(activityId, { editsPaused: true });

test('FR-009 the preview re-reads every target, lists winners and current targets, and never writes', async (t) => {
  const { exporter, activityId, spreadsheet } = writeBackActivity(t);
  spreadsheet.sheets.get(5).title = '題組（改名）';
  const preview = await exporter.preview(activityId);
  assert.equal(preview.spreadsheetId, SPREADSHEET);
  assert.deepEqual(preview.items.map(({ questionKey, unitLabel, groupName, content, target, status }) => [
    questionKey, unitLabel, groupName, content, target, status,
  ]), [
    ['1', 'Q:1', '甲組', '=1+1', { sheetId: 0, sheetTitle: '單題', cell: 'B2' }, 'READY'],
    ['2', 'G:A', '乙組', '第一行\n第二行', { sheetId: 5, sheetTitle: '題組（改名）', cell: 'B3' }, 'READY'],
    ['3', 'G:A', '乙組', '中文答案', { sheetId: 5, sheetTitle: '題組（改名）', cell: 'B4' }, 'READY'],
    ['4', 'G:A', '乙組', "'單引號開頭", { sheetId: 5, sheetTitle: '題組（改名）', cell: 'D5' }, 'READY'],
    ['5', 'Q:5', null, null, { sheetId: 0, sheetTitle: '單題', cell: 'B6' }, 'NO_ANSWER'],
  ]);
  assert.deepEqual(preview.counts, { READY: 4, ALREADY_PRESENT: 0, CONFLICT: 0, NO_ANSWER: 1 });
  assert.equal(spreadsheet.log.writes.length, 0);
});

test('AC-12/AC-17 each winning answer is written as plain text to its own cell and verified by reading back', async (t) => {
  const { db, exporter, activityId, spreadsheet } = writeBackActivity(t);
  const before = savedResults(db);
  const record = await writeBack(exporter, activityId);
  assert.equal(record.outcome, 'SUCCEEDED');
  assert.equal(record.error, null);
  assert.deepEqual(statuses(record), [['1', 'WRITTEN', null], ['2', 'WRITTEN', null], ['3', 'WRITTEN', null], ['4', 'WRITTEN', null]]);
  assert.equal(spreadsheet.log.writes.length, 1);
  assert.deepEqual(spreadsheet.log.writes[0].map(({ sheetId, rowIndex, columnIndex, text: value }) => [sheetId, rowIndex, columnIndex, value]), [
    [0, 1, 1, '=1+1'], [5, 2, 1, '第一行\n第二行'], [5, 3, 1, '中文答案'], [5, 4, 3, "'單引號開頭"],
  ]);
  assert.equal(spreadsheet.text(0, 5, 1), '{{Q:5}}');
  assert.equal(spreadsheet.log.reads, 2);
  assert.deepEqual(savedResults(db), before);
  assert.deepEqual(exporter.latest(activityId), record);
});

test('AC-13 one conflicting target stops the whole write-back before any cell is written', async (t) => {
  const { exporter, activityId, spreadsheet } = writeBackActivity(t);
  spreadsheet.set(5, 2, 1, { stringValue: '有人改寫' });
  spreadsheet.sheets.get(5).merges.push({ startRowIndex: 3, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 3 });
  const preview = await exporter.preview(activityId);
  assert.deepEqual(preview.items.map(({ questionKey, status, reason }) => [questionKey, status, reason ?? null]), [
    ['1', 'READY', null], ['2', 'CONFLICT', 'CHANGED'], ['3', 'CONFLICT', 'MERGED'], ['4', 'READY', null], ['5', 'NO_ANSWER', null],
  ]);
  const record = await writeBack(exporter, activityId);
  assert.equal(record.outcome, 'CONFLICT');
  assert.deepEqual(statuses(record), [['1', 'SKIPPED', null], ['2', 'CONFLICT', 'CHANGED'], ['3', 'CONFLICT', 'MERGED'], ['4', 'SKIPPED', null]]);
  assert.equal(spreadsheet.log.writes.length, 0);
  assert.equal(spreadsheet.text(0, 1, 1), '{{Q:1}}');
});

test('AC-13 a deleted sheet or removed rows are conflicts, never writes to the old coordinates', async (t) => {
  const { exporter, activityId, spreadsheet } = writeBackActivity(t);
  spreadsheet.sheets.delete(5);
  spreadsheet.sheets.get(0).rowCount = 1;
  const record = await writeBack(exporter, activityId);
  assert.equal(record.outcome, 'CONFLICT');
  assert.deepEqual(statuses(record), [
    ['1', 'CONFLICT', 'OUT_OF_RANGE'], ['2', 'CONFLICT', 'SHEET_MISSING'], ['3', 'CONFLICT', 'SHEET_MISSING'], ['4', 'CONFLICT', 'SHEET_MISSING'],
  ]);
  assert.equal(record.items[1].target.sheetTitle, '題組');
  assert.equal(spreadsheet.log.writes.length, 0);
});

test('AC-14 a refused write is reported as failed and the cells are not read back as success', async (t) => {
  const { exporter, activityId, spreadsheet } = writeBackActivity(t);
  spreadsheet.hooks.write = () => ({ apply: false, error: new AppError(403, 'SHEETS_PERMISSION', '服務帳戶無法存取試算表。') });
  const record = await writeBack(exporter, activityId);
  assert.equal(record.outcome, 'FAILED');
  assert.equal(record.error.code, 'SHEETS_PERMISSION');
  assert.deepEqual(distinct(record), ['FAILED:SHEETS_PERMISSION']);
  assert.equal(spreadsheet.log.reads, 1);
});

test('AC-14 a timed-out write is settled by reading the cells back', async (t) => {
  const timeout = () => new AppError(504, 'SHEETS_TIMEOUT', '連線 Google 逾時，請稍後再試。');
  const applied = writeBackActivity(t);
  applied.spreadsheet.hooks.write = () => ({ apply: true, error: timeout() });
  const written = await writeBack(applied.exporter, applied.activityId);
  assert.equal(written.outcome, 'SUCCEEDED');
  assert.deepEqual(distinct(written), ['WRITTEN']);

  const lost = writeBackActivity(t);
  lost.spreadsheet.hooks.write = () => ({ apply: false, error: timeout() });
  const failed = await writeBack(lost.exporter, lost.activityId);
  assert.equal(failed.outcome, 'FAILED');
  assert.equal(failed.error.code, 'SHEETS_TIMEOUT');
  assert.deepEqual(distinct(failed), ['FAILED:SHEETS_TIMEOUT']);
});

test('AC-14 an unconfirmed write is pending verification, and the retry recognizes the written answers', async (t) => {
  const { exporter, activityId, spreadsheet } = writeBackActivity(t);
  const offline = () => new AppError(502, 'SHEETS_NETWORK', '無法連線 Google，請檢查網路後再試。');
  spreadsheet.hooks.write = () => ({ apply: true, error: offline() });
  spreadsheet.hooks.read = (count) => { if (count === 2) throw offline(); };
  const pending = await writeBack(exporter, activityId);
  assert.equal(pending.outcome, 'UNKNOWN');
  assert.deepEqual(distinct(pending), ['UNKNOWN:SHEETS_NETWORK']);

  delete spreadsheet.hooks.write;
  delete spreadsheet.hooks.read;
  const retry = await writeBack(exporter, activityId);
  assert.equal(retry.outcome, 'SUCCEEDED');
  assert.deepEqual(distinct(retry), ['ALREADY_PRESENT']);
  assert.equal(spreadsheet.log.writes.length, 1);
});

test('AC-14 repeating a finished write-back writes nothing and never overwrites an external edit', async (t) => {
  const { exporter, activityId, spreadsheet } = writeBackActivity(t);
  await writeBack(exporter, activityId);
  const again = await writeBack(exporter, activityId);
  assert.equal(again.outcome, 'SUCCEEDED');
  assert.deepEqual(distinct(again), ['ALREADY_PRESENT']);

  spreadsheet.set(0, 1, 1, { stringValue: '老師手動修改' });
  const edited = await writeBack(exporter, activityId);
  assert.equal(edited.outcome, 'CONFLICT');
  assert.deepEqual(statuses(edited)[0], ['1', 'CONFLICT', 'CHANGED']);
  assert.equal(spreadsheet.text(0, 1, 1), '老師手動修改');
  assert.equal(spreadsheet.log.writes.length, 1);
});

test('FR-017 write-backs of the same activity are mutually exclusive', async (t) => {
  const { exporter, activityId, spreadsheet } = writeBackActivity(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  spreadsheet.hooks.read = (count) => (count === 1 ? gate : undefined);
  const first = writeBack(exporter, activityId);
  await assert.rejects(writeBack(exporter, activityId), { status: 409, code: 'EXPORT_IN_PROGRESS' });
  assert.equal(exporter.latest(activityId).outcome, 'RUNNING');
  release();
  assert.equal((await first).outcome, 'SUCCEEDED');
});

test('FR-017 a write-back interrupted by a restart is shown as pending verification', async (t) => {
  const { db, activityId, spreadsheet } = writeBackActivity(t);
  const { lastInsertRowid: exportId } = db.prepare(`
    INSERT INTO sheet_exports (activity_id, started_at, outcome) VALUES (?, '2026-11-20T08:59:00.000Z', 'RUNNING')
  `).run(activityId);
  const { id: questionId } = db.prepare("SELECT id FROM questions WHERE activity_id = ? AND question_key = '1'").get(activityId);
  db.prepare(`
    INSERT INTO sheet_export_items (export_id, question_id, spreadsheet_id, sheet_id, sheet_title, row_index, column_index, content, status)
    VALUES (?, ?, ?, 0, '單題', 1, 1, '=1+1', 'PENDING')
  `).run(exportId, questionId, SPREADSHEET);

  const restarted = createSheetsExporter({ db, clock: createFixedClock('2026-11-20T09:05:00.000Z'), sheetsGateway: spreadsheet.gateway });
  const latest = restarted.latest(activityId);
  assert.equal(latest.outcome, 'UNKNOWN');
  assert.equal(latest.error.code, 'INTERRUPTED');
  assert.equal(latest.finishedAt, '2026-11-20T09:05:00.000Z');
  assert.deepEqual(statuses(latest), [['1', 'UNKNOWN', 'INTERRUPTED']]);
  assert.equal((await writeBack(restarted, activityId)).outcome, 'SUCCEEDED');
});

test('write-back is refused before closing, without the pause confirmation, or when nobody answered', async (t) => {
  const open = writeBackActivity(t, { close: false });
  await assert.rejects(writeBack(open.exporter, open.activityId), { status: 409, code: 'INVALID_PHASE' });
  await assert.rejects(open.exporter.preview(open.activityId), { status: 409, code: 'INVALID_PHASE' });

  const { db, exporter, activityId } = writeBackActivity(t);
  await assert.rejects(exporter.run(activityId, {}), { status: 400, code: 'EDITS_PAUSE_REQUIRED' });
  await assert.rejects(exporter.run(activityId, { editsPaused: 'yes' }), { status: 400, code: 'EDITS_PAUSE_REQUIRED' });
  assert.equal(db.prepare('SELECT count(*) AS n FROM sheet_exports').get().n, 0);

  const silent = writeBackActivity(t, { answered: false });
  await assert.rejects(writeBack(silent.exporter, silent.activityId), { status: 409, code: 'NOTHING_TO_EXPORT' });
  const preview = await silent.exporter.preview(silent.activityId);
  assert.deepEqual(preview.counts, { READY: 0, ALREADY_PRESENT: 0, CONFLICT: 0, NO_ANSWER: 5 });
  assert.equal(silent.spreadsheet.log.reads, 0);
});

test('a failed verification read is recorded as a failed attempt without writing', async (t) => {
  const { exporter, activityId, spreadsheet } = writeBackActivity(t);
  spreadsheet.hooks.read = () => { throw new AppError(403, 'SHEETS_PERMISSION', '服務帳戶無法存取試算表。'); };
  await assert.rejects(exporter.preview(activityId), { code: 'SHEETS_PERMISSION' });
  const record = await writeBack(exporter, activityId);
  assert.equal(record.outcome, 'FAILED');
  assert.equal(record.error.code, 'SHEETS_PERMISSION');
  assert.deepEqual(distinct(record), ['FAILED:SHEETS_PERMISSION']);
  assert.equal(spreadsheet.log.writes.length, 0);
});
