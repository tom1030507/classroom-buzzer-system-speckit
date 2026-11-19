import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { test } from 'node:test';
import { AppError } from '../../../src/lib/errors.js';
import { browser } from '../../helpers/browser.js';
import { insertActivity, insertSingleUnit, openActivity } from '../../helpers/fixtures.js';
import { startTestApp } from '../../helpers/test-app.js';

const password = 'teacher-test-passphrase';
const post = (body) => ({ method: 'POST', body });
const grid = (id, title, rowIndex, columnIndex, cells, merges = []) => ({
  id, title, merges, gridProperties: { rowCount: 50, columnCount: 50 },
  data: [{ startRow: rowIndex, startColumn: columnIndex, rowData: [{
    values: cells.map((stringValue) => ({ userEnteredValue: { stringValue } })),
  }] }],
});
const worksheets = [
  grid(17, 'A表', 3, 1, ['{{Q:34|G:B}}', '{{Q:23}}', '{{Q:72|G:B}}']),
  grid(0, 'B表', 0, 0, ['　{{Q:5}} ', '{{Q:18|G:B}}']),
];

async function setup(t, options = {}) {
  const gateway = {
    async listSheets() {
      return worksheets.map(({ id, title }) => ({ id, title }));
    },
    async readSheets(spreadsheetId, sheetIds) {
      assert.equal(spreadsheetId, 'valid-sheet-id');
      return sheetIds.map((id) => worksheets.find((sheet) => sheet.id === id));
    },
    ...options,
  };
  const app = await startTestApp({ sheetsGateway: gateway });
  t.after(() => app.close());
  const salt = Buffer.alloc(16, 42);
  app.db.prepare('INSERT INTO teacher_settings (id, salt, password_hash) VALUES (1, ?, ?)')
    .run(salt, scryptSync(password, salt, 64));
  const teacher = await signIn(app);
  async function request(activityId, endpoint, body) {
    return teacher.request(`activities/${activityId}/import${endpoint}`, body ? post(body) : undefined);
  }
  return { app, teacher, request };
}

async function signIn(app) {
  const teacher = browser(app, 'teacher');
  await teacher.request('session');
  assert.equal((await teacher.request('login', post({ password }))).status, 200);
  return teacher;
}

const validPreview = { spreadsheet: 'https://docs.google.com/spreadsheets/d/valid-sheet-id/edit', sheetIds: [0, 17] };
const importedQuestions = (db, activityId) => db.prepare(`
  SELECT question_key, sheet_id, row_index, column_index, original_marker
  FROM questions WHERE activity_id = ? ORDER BY position
`).all(activityId).map((row) => Object.values(row));

test('AC-17 teacher chooses ordered sheets, previews five questions and atomically confirms three units', async (t) => {
  const { app, request } = await setup(t);
  const activityId = insertActivity(app.db);
  insertSingleUnit(app.db, activityId, { questionKey: 'old' });
  const listing = await request(activityId, '/sheets', { spreadsheet: validPreview.spreadsheet });
  assert.equal(listing.status, 200);
  assert.deepEqual(listing.data, { spreadsheetId: 'valid-sheet-id', sheets: [{ id: 17, title: 'A表' }, { id: 0, title: 'B表' }] });
  const listed = await request(activityId, '/preview', validPreview);
  assert.equal(listed.status, 200);
  const { previewId, preview } = listed.data;
  assert.equal(preview.questionCount, 5);
  assert.equal(preview.unitCount, 3);
  assert.deepEqual(preview.units.map((unit) => unit.questions.map(({ key }) => key)), [['5'], ['18', '34', '72'], ['23']]);
  assert.deepEqual(importedQuestions(app.db, activityId).map(([key]) => key), ['old']);
  const confirmed = await request(activityId, '/confirm', { previewId });
  assert.equal(confirmed.status, 200);
  assert.deepEqual(confirmed.data.imported, preview);
  assert.deepEqual((await request(activityId, '')).data.imported, preview);
  assert.deepEqual(importedQuestions(app.db, activityId), [
    ['5', 0, 0, 0, '　{{Q:5}} '],
    ['18', 0, 0, 1, '{{Q:18|G:B}}'],
    ['34', 17, 3, 1, '{{Q:34|G:B}}'],
    ['23', 17, 3, 2, '{{Q:23}}'],
    ['72', 17, 3, 3, '{{Q:72|G:B}}'],
  ]);
  assert.equal((await request(activityId, '/confirm', { previewId })).data.error.code, 'IMPORT_PREVIEW_INVALID');
});

test('AC-03 all parser and access failures preserve the previous confirmed import', async (t) => {
  let readSelected;
  const { app, request } = await setup(t, { readSheets: async () => readSelected() });
  const activityId = insertActivity(app.db);
  insertSingleUnit(app.db, activityId, { questionKey: 'old' });
  const original = importedQuestions(app.db, activityId);
  const failures = [
    [[], 'IMPORT_NO_QUESTIONS'],
    [['{{Q:1}}', '{{Q:1}}'], 'IMPORT_DUPLICATE_QUESTION'],
    [['{{Q:bad/cell}}'], 'IMPORT_INVALID_MARKER'],
    [['{{Q:1|G:alone}}'], 'IMPORT_SINGLE_MEMBER_GROUP'],
  ];
  for (const [cells, code] of failures) {
    readSelected = () => [grid(0, 'import', 0, 0, cells)];
    assert.equal((await request(activityId, '/preview', validPreview)).data.error.code, code);
    assert.deepEqual(importedQuestions(app.db, activityId), original);
  }
  readSelected = () => [grid(0, 'import', 0, 0, ['{{Q:1}}'], [{ endRowIndex: 1, endColumnIndex: 2 }])];
  assert.equal((await request(activityId, '/preview', validPreview)).data.error.code, 'IMPORT_MERGED_CELL');
  for (const code of ['SHEETS_NETWORK', 'SHEETS_PERMISSION']) {
    readSelected = () => { throw new AppError(502, code, 'Google 無法完成要求。'); };
    assert.equal((await request(activityId, '/preview', validPreview)).data.error.code, code);
  }
  assert.deepEqual(importedQuestions(app.db, activityId), original);
});

test('AC-03 a failed insert rolls back deletion of the old import and can be retried', async (t) => {
  const { app, request } = await setup(t);
  const activityId = insertActivity(app.db);
  insertSingleUnit(app.db, activityId, { questionKey: 'old' });
  const { data: { previewId } } = await request(activityId, '/preview', validPreview);
  app.db.exec(`CREATE TEMP TRIGGER reject_question BEFORE INSERT ON questions
    WHEN NEW.question_key = '34' BEGIN SELECT RAISE(ABORT, 'forced rollback'); END`);
  const before = importedQuestions(app.db, activityId);
  assert.equal((await request(activityId, '/confirm', { previewId })).status, 500);
  assert.deepEqual(importedQuestions(app.db, activityId), before);
  app.db.exec('DROP TRIGGER reject_question');
  assert.equal((await request(activityId, '/confirm', { previewId })).status, 200);
});

test('teacher login and CSRF gate every import operation, previews are scoped and phase is rechecked', async (t) => {
  const { app, teacher, request } = await setup(t);
  const activityId = insertActivity(app.db);
  const secondActivity = insertActivity(app.db);
  const root = `activities/${activityId}/import`;
  const anonymous = browser(app, 'teacher');
  assert.equal((await anonymous.request(root)).status, 401);
  for (const endpoint of ['sheets', 'preview', 'confirm']) {
    assert.equal((await anonymous.request(`${root}/${endpoint}`, post({}))).status, 401);
  }
  assert.equal((await teacher.request(`${root}/preview`, {
    ...post(validPreview), headers: { 'X-CSRF-Token': 'invalid' },
  })).status, 403);
  assert.equal((await teacher.request(`${root}/preview`, {
    ...post(validPreview), headers: { Origin: 'http://example.test' },
  })).status, 403);
  const { data: { previewId } } = await request(activityId, '/preview', validPreview);
  assert.equal((await request(secondActivity, '/confirm', { previewId })).data.error.code, 'IMPORT_PREVIEW_INVALID');
  const otherTeacher = await signIn(app);
  assert.equal((await otherTeacher.request(`${root}/confirm`, post({ previewId }))).data.error.code, 'IMPORT_PREVIEW_INVALID');
  app.clock.advance(16 * 60 * 1000);
  assert.equal((await request(activityId, '/confirm', { previewId })).data.error.code, 'IMPORT_PREVIEW_INVALID');
  const { data: next } = await request(activityId, '/preview', validPreview);
  openActivity(app.db, activityId);
  assert.equal((await request(activityId, '/confirm', { previewId: next.previewId })).data.error.code, 'INVALID_PHASE');
  assert.equal((await request(activityId, '/sheets', { spreadsheet: validPreview.spreadsheet })).data.error.code, 'INVALID_PHASE');
  assert.equal((await request(activityId, '/preview', validPreview)).data.error.code, 'INVALID_PHASE');
  assert.equal(importedQuestions(app.db, activityId).length, 0);
});

test('AC-03 a Google read completing after activity opens cannot prepare a new import', async (t) => {
  const { promise: started, resolve: begin } = Promise.withResolvers();
  const { promise: completed, resolve: finish } = Promise.withResolvers();
  const { app, request } = await setup(t, {
    readSheets: async () => {
      begin();
      await completed;
      return worksheets;
    },
  });
  const activityId = insertActivity(app.db);
  insertSingleUnit(app.db, activityId, { questionKey: 'old' });
  const loading = request(activityId, '/preview', validPreview);
  await Promise.race([started, loading.then((response) => assert.fail(`unexpected response ${response.status}`))]);
  try {
    openActivity(app.db, activityId);
  } finally {
    finish();
  }
  assert.equal((await loading).data.error.code, 'INVALID_PHASE');
  assert.deepEqual(importedQuestions(app.db, activityId).map(([key]) => key), ['old']);
});
