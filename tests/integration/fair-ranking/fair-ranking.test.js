import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../../../src/server.js';
import { silentLogger } from '../../../src/lib/logger.js';
import { listWinningAnswers } from '../../../src/features/results-export/results.js';
import { browser } from '../../helpers/browser.js';
import { insertSingleUnit } from '../../helpers/fixtures.js';
import { startTestApp } from '../../helpers/test-app.js';

const password = 'fair-teacher-password';
const post = (client, path, body = {}) => client.request(path, { method: 'POST', body });
const api = (id, action) => `activities/${id}/${action}`;
const answer = (questionKey, text) => ({ questionKey, text });
const close = (teacher, id) => post(teacher, api(id, 'close'), { confirm: true });

async function makeTeacher(app) {
  const salt = Buffer.alloc(16, 21);
  app.db.prepare('INSERT INTO teacher_settings (id, salt, password_hash) VALUES (1, ?, ?)')
    .run(salt, scryptSync(password, salt, 64));
  const teacher = browser(app, 'teacher');
  await teacher.request('session');
  assert.equal((await post(teacher, 'login', { password })).status, 200);
  return teacher;
}

async function joinGroup(app, joinCode, name) {
  const student = browser(app, 'student');
  await student.request('session');
  assert.equal((await post(student, 'join', { joinCode, name })).status, 201);
  return student;
}

/** Copies one browser's session cookie into a fresh client of another role or server. */
function withCookie(app, role, from, cookie) {
  const client = browser(app, role);
  client.cookies.set(cookie, from.cookies.get(cookie));
  return client;
}

const modePath = (id) => api(id, 'mode');
const modeOf = (app, id) => app.db.prepare('SELECT mode FROM activities WHERE id = ?').get(id).mode;

/** A preparing activity with single-question units "1", "2", … (the speed mode default). */
async function createActivity(app, teacher, { units: unitCount = 1 } = {}) {
  const { activity } = (await post(teacher, 'activities')).data;
  const units = Array.from({ length: unitCount }, (_, index) => {
    const key = String(index + 1);
    return { ...insertSingleUnit(app.db, activity.id, { questionKey: key }), key };
  });
  return { activity, units };
}

/**
 * Creates an activity with single-question units "1", "2", … and two groups (甲組, 乙組), then opens it.
 * The mode is set directly in the database while the activity is still PREPARING, which keeps the
 * results tests independent of the mode endpoint (that endpoint has its own tests below).
 */
async function openActivity(app, teacher, { units: unitCount = 2, mode = 'FAIR' } = {}) {
  const { activity, units } = await createActivity(app, teacher, { units: unitCount });
  app.db.prepare('UPDATE activities SET mode = ? WHERE id = ?').run(mode, activity.id);
  const alpha = await joinGroup(app, activity.joinCode, '甲組');
  const beta = await joinGroup(app, activity.joinCode, '乙組');
  assert.equal((await post(teacher, api(activity.id, 'open'))).status, 200);
  return { activity, units, alpha, beta };
}

async function submit(student, unit, text) {
  const response = await post(student, `units/${unit.unitId}/submissions`, { answers: [answer(unit.key, text)] });
  assert.equal(response.status, 201);
}

/** AC-21: 甲組 answers both units just before 乙組, so 甲組 is faster every time. */
async function playAc21(app, teacher) {
  const game = await openActivity(app, teacher);
  const [one, two] = game.units;
  await submit(game.alpha, one, '甲組第一題');
  await submit(game.beta, one, '乙組第一題');
  await submit(game.alpha, two, '甲組第二題');
  await submit(game.beta, two, '乙組第二題');
  return game;
}

/** Reads the snapshots of an SSE stream one by one. */
async function snapshots(t, client, path) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await client.request(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  return async () => {
    for (;;) {
      const boundary = buffered.indexOf('\n\n');
      if (boundary !== -1) {
        const event = buffered.slice(0, boundary);
        buffered = buffered.slice(boundary + 2);
        if (event.startsWith(':')) continue;
        assert.match(event, /^event: snapshot\ndata: /);
        return JSON.parse(event.slice('event: snapshot\ndata: '.length));
      }
      const message = await reader.read();
      assert.equal(message.done, false, 'SSE ended before receiving a snapshot');
      buffered += message.value;
    }
  };
}

const summary = (unit) => unit.entries.map(({ groupName, rank, acceptedOrder, isWinner }) => [
  groupName, rank, acceptedOrder, isWinner,
]);

// ── User story 1: fair ranks at close ──────────────────────────────────────────

test('AC-21 closing a fair activity saves fair ranks that the teacher and every group read alike', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity, alpha, beta } = await playAc21(app, teacher);

  const closed = await close(teacher, activity.id);
  assert.equal(closed.status, 200);
  assert.deepEqual(closed.data.activity, { id: activity.id, mode: 'FAIR', status: 'CLOSED' });

  const results = await teacher.request(api(activity.id, 'results'));
  assert.equal(results.status, 200);
  assert.equal(results.data.activity.mode, 'FAIR');
  const [first, second] = results.data.units;
  // 甲組 wins the first unit; the second unit goes to 乙組 although 甲組 was accepted first.
  assert.deepEqual(summary(first), [['甲組', 1, 1, true], ['乙組', 2, 2, false]]);
  assert.deepEqual(summary(second), [['乙組', 1, 2, true], ['甲組', 2, 1, false]]);

  for (const student of [alpha, beta]) {
    const seen = await student.request('results');
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.data, results.data);
  }
});

test('FR-006 a fair activity closes with an unanswered unit, and with no answers at all', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);

  const partial = await openActivity(app, teacher);
  await submit(partial.alpha, partial.units[0], '甲組第一題');
  assert.equal((await close(teacher, partial.activity.id)).status, 200);
  const [answered, unanswered] = (await teacher.request(api(partial.activity.id, 'results'))).data.units;
  assert.equal(answered.noAnswer, false);
  assert.equal(unanswered.noAnswer, true);
  assert.deepEqual(summary(answered), [['甲組', 1, 1, true]]);

  const silent = await openActivity(app, teacher);
  assert.equal((await close(teacher, silent.activity.id)).status, 200);
  const results = await teacher.request(api(silent.activity.id, 'results'));
  assert.equal(results.status, 200);
  assert.deepEqual(results.data.units.map(({ noAnswer }) => noAnswer), [true, true]);
});

test('AC-22 fair results stay the same after the server restarts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fair-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { PORT: '0', DATABASE_FILE: join(directory, 'buzzer.sqlite') };
  async function boot() {
    const running = await startServer({ env, logger: silentLogger });
    const baseUrl = `http://127.0.0.1:${running.server.address().port}`;
    return { ...running, baseUrl, request: (path, options) => fetch(new URL(path, baseUrl), options) };
  }

  let saved;
  const first = await boot();
  try {
    const teacher = await makeTeacher(first);
    const { activity, alpha } = await playAc21(first, teacher);
    await close(teacher, activity.id);
    const read = await teacher.request(api(activity.id, 'results'));
    assert.equal(read.status, 200);
    saved = { id: activity.id, results: read.data, teacher, alpha };
  } finally {
    await first.close();
  }

  const second = await boot();
  t.after(() => second.close());
  const teacher = withCookie(second, 'teacher', saved.teacher, 'buzzer_teacher');
  const alpha = withCookie(second, 'student', saved.alpha, 'buzzer_group');
  for (const reread of [await teacher.request(api(saved.id, 'results')), await alpha.request('results')]) {
    assert.equal(reread.status, 200);
    assert.deepEqual(reread.data, saved.results);
    assert.deepEqual(summary(reread.data.units[1]), [['乙組', 1, 2, true], ['甲組', 2, 1, false]]);
  }
});

// ── User story 2: choosing the mode while preparing, locked once open ────────────────

test('FR-007 the teacher selects and changes the mode while the activity is preparing', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity } = await createActivity(app, teacher);
  assert.equal(activity.mode, 'SPEED');

  const fair = await post(teacher, modePath(activity.id), { mode: 'FAIR' });
  assert.equal(fair.status, 200);
  assert.deepEqual(fair.data.activity, { ...activity, mode: 'FAIR' });
  assert.equal(modeOf(app, activity.id), 'FAIR');

  assert.equal((await post(teacher, modePath(activity.id), { mode: 'FAIR' })).status, 200);
  const speed = await post(teacher, modePath(activity.id), { mode: 'SPEED' });
  assert.equal(speed.status, 200);
  assert.equal(speed.data.activity.mode, 'SPEED');
  assert.equal(modeOf(app, activity.id), 'SPEED');
});

test('FR-009 AC-16 students, anonymous callers and requests without Origin or CSRF cannot change the mode', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity } = await createActivity(app, teacher);
  const student = await joinGroup(app, activity.joinCode, '甲組');
  const path = modePath(activity.id);

  const intruder = withCookie(app, 'teacher', student, 'buzzer_group');
  const asStudent = await post(intruder, path, { mode: 'FAIR' });
  assert.equal(asStudent.status, 401);
  assert.equal(asStudent.data.error.code, 'TEACHER_REQUIRED');
  assert.equal((await post(browser(app, 'teacher'), path, { mode: 'FAIR' })).data.error.code, 'TEACHER_REQUIRED');

  const noCsrf = await teacher.request(path, { method: 'POST', body: { mode: 'FAIR' }, headers: { 'X-CSRF-Token': '' } });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.data.error.code, 'INVALID_CSRF');
  const foreign = await teacher.request(path, { method: 'POST', body: { mode: 'FAIR' }, headers: { Origin: 'http://evil.example' } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.data.error.code, 'INVALID_ORIGIN');

  assert.equal(modeOf(app, activity.id), 'SPEED');
});

test('FR-009 a body that is not exactly a valid mode is a 400, and an unknown activity is a 404', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity } = await createActivity(app, teacher);
  const path = modePath(activity.id);

  const noBody = await teacher.request(path, { method: 'POST' });
  assert.equal(noBody.status, 400);
  assert.equal(noBody.data.error.code, 'INVALID_MODE');
  for (const body of [{}, { mode: 'speed' }, { mode: '' }, { mode: null }, { mode: ['FAIR'] }, { mode: 'FAIR', extra: 1 }]) {
    const refused = await post(teacher, path, body);
    assert.equal(refused.status, 400, JSON.stringify(body));
    assert.equal(refused.data.error.code, 'INVALID_MODE');
  }
  assert.equal(modeOf(app, activity.id), 'SPEED');

  const missing = await post(teacher, modePath('missing-activity'), { mode: 'FAIR' });
  assert.equal(missing.status, 404);
  assert.equal(missing.data.error.code, 'ACTIVITY_NOT_FOUND');
});

test('AC-23 once the activity is open or closed the mode cannot change, not even to the same mode', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity } = await createActivity(app, teacher);
  assert.equal((await post(teacher, modePath(activity.id), { mode: 'FAIR' })).status, 200);
  assert.equal((await post(teacher, api(activity.id, 'open'))).status, 200);

  for (const stage of ['open', 'closed']) {
    if (stage === 'closed') assert.equal((await close(teacher, activity.id)).status, 200);
    for (const mode of ['FAIR', 'SPEED']) {
      const refused = await post(teacher, modePath(activity.id), { mode });
      assert.equal(refused.status, 409, `${stage} ${mode}`);
      assert.equal(refused.data.error.code, 'INVALID_PHASE');
      assert.equal(modeOf(app, activity.id), 'FAIR');
    }
  }
});

test('FR-011 a mode change reaches the teacher and the joined students within two seconds', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity } = await createActivity(app, teacher);
  const alpha = await joinGroup(app, activity.joinCode, '甲組');
  const readTeacher = await snapshots(t, teacher, api(activity.id, 'events'));
  const readAlpha = await snapshots(t, alpha, 'events');
  assert.equal((await readTeacher()).activity.mode, 'SPEED');
  assert.equal((await readAlpha()).activity.mode, 'SPEED');

  const started = performance.now();
  assert.equal((await post(teacher, modePath(activity.id), { mode: 'FAIR' })).status, 200);
  const [teacherSnapshot, alphaSnapshot] = await Promise.all([readTeacher(), readAlpha()]);
  assert.equal(teacherSnapshot.activity.mode, 'FAIR');
  assert.equal(alphaSnapshot.activity.mode, 'FAIR');
  assert.ok(performance.now() - started < 2000);

  assert.equal((await teacher.request(api(activity.id, 'live'))).data.activity.mode, 'FAIR');
  assert.equal((await alpha.request('activity')).data.activity.mode, 'FAIR');

  const latecomer = browser(app, 'student');
  await latecomer.request('session');
  const joined = await post(latecomer, 'join', { joinCode: activity.joinCode, name: '乙組' });
  assert.equal(joined.status, 201);
  assert.equal(joined.data.activity.mode, 'FAIR');
  assert.equal((await latecomer.request('session')).data.activity.mode, 'FAIR');
});

test('AC-23 changing the mode and opening at the same moment has exactly one outcome', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);

  for (let round = 0; round < 20; round += 1) {
    const { activity } = await createActivity(app, teacher);
    const [selected, opened] = await Promise.all([
      post(teacher, modePath(activity.id), { mode: 'FAIR' }),
      post(teacher, api(activity.id, 'open')),
    ]);
    assert.equal(opened.status, 200);
    const mode = modeOf(app, activity.id);
    if (selected.status === 200) {
      assert.equal(mode, 'FAIR', 'the change came first, so the activity opened in fair mode');
    } else {
      assert.equal(selected.status, 409);
      assert.equal(selected.data.error.code, 'INVALID_PHASE');
      assert.equal(mode, 'SPEED', 'opening came first, so the mode stayed');
    }
    const later = await post(teacher, modePath(activity.id), { mode: mode === 'FAIR' ? 'SPEED' : 'FAIR' });
    assert.equal(later.status, 409);
    assert.equal(modeOf(app, activity.id), mode);
    assert.equal((await close(teacher, activity.id)).status, 200);
  }
});

test('two simultaneous mode changes both succeed and leave one consistent mode', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity } = await createActivity(app, teacher);
  const [toFair, toSpeed] = await Promise.all([
    post(teacher, modePath(activity.id), { mode: 'FAIR' }),
    post(teacher, modePath(activity.id), { mode: 'SPEED' }),
  ]);
  assert.equal(toFair.status, 200);
  assert.equal(toSpeed.status, 200);
  const mode = modeOf(app, activity.id);
  assert.ok(['FAIR', 'SPEED'].includes(mode));
  assert.equal((await teacher.request(api(activity.id, 'live'))).data.activity.mode, mode);
});

test('AC-09 FR-012 a fair activity shows a group nothing about the others, and the teacher no provisional winner', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const fairGame = await createActivity(app, teacher, { units: 2 });
  assert.equal((await post(teacher, modePath(fairGame.activity.id), { mode: 'FAIR' })).status, 200);
  const alpha = await joinGroup(app, fairGame.activity.joinCode, '甲組');
  const beta = await joinGroup(app, fairGame.activity.joinCode, '乙組');
  assert.equal((await post(teacher, api(fairGame.activity.id, 'open'))).status, 200);

  const before = await alpha.request('activity');
  await submit(beta, fairGame.units[0], '乙組第一題');
  const after = await alpha.request('activity');
  assert.deepEqual(after.data, before.data, "乙組's submission changes nothing 甲組 can see");
  assert.doesNotMatch(JSON.stringify(after.data), /乙組/);

  // The teacher sees who was accepted in which order, but no provisional winner in fair mode (FR-012).
  await submit(alpha, fairGame.units[0], '甲組第一題');
  const fairLive = (await teacher.request(api(fairGame.activity.id, 'live'))).data;
  assert.equal(fairLive.activity.mode, 'FAIR');
  assert.deepEqual(fairLive.units.map((unit) => unit.winnerGroupId), [null, null]);
  assert.deepEqual(fairLive.units[0].submissions.map((entry) => entry.acceptSeq), [1, 2]);

  // The fair snapshot has exactly the fields a speed activity has: no win counts, ranks or winners.
  // A teacher has one unfinished activity at a time (AC-24), so the speed activity follows the fair one.
  assert.equal((await close(teacher, fairGame.activity.id)).status, 200);
  const speedGame = await createActivity(app, teacher, { units: 2 });
  const gamma = await joinGroup(app, speedGame.activity.joinCode, '丙組');
  assert.equal((await post(teacher, api(speedGame.activity.id, 'open'))).status, 200);
  const shape = ({ data }) => ({
    top: Object.keys(data).sort(),
    activity: Object.keys(data.activity).sort(),
    unit: Object.keys(data.units[0]).sort(),
  });
  assert.deepEqual(shape(after), shape(await gamma.request('activity')));
  assert.deepEqual(shape(after).activity, ['id', 'mode', 'status']);

  await submit(gamma, speedGame.units[0], '丙組第一題');
  const speedLive = (await teacher.request(api(speedGame.activity.id, 'live'))).data;
  assert.equal(speedLive.units[0].winnerGroupId, speedLive.units[0].submissions[0].groupId);
  assert.notEqual(speedLive.units[0].winnerGroupId, null);
});

// ── User story 3: the result page, the write-back and the CSV agree ────────────────────

/** Spreadsheet double that starts with every imported marker in place (automated tests only). */
function markerSpreadsheet() {
  const cells = new Map();
  const key = ({ sheetId, rowIndex, columnIndex }) => `${sheetId}:${rowIndex}:${columnIndex}`;
  const sheet = { id: 0, title: 'Sheet1', rowCount: 100, columnCount: 26, merges: [] };
  return {
    load(db, activityId) {
      for (const row of db.prepare(`
        SELECT sheet_id AS sheetId, row_index AS rowIndex, column_index AS columnIndex, original_marker AS marker
        FROM questions WHERE activity_id = ?
      `).all(activityId)) cells.set(key(row), { stringValue: row.marker });
    },
    async readTargets(spreadsheetId, targets) {
      return targets.map((target) => ({ sheet, value: cells.get(key(target)) ?? null }));
    },
    async writeCells(spreadsheetId, written) {
      for (const cell of written) cells.set(key(cell), { stringValue: cell.text });
    },
  };
}

/**
 * Two single-question units and two groups, with the mode chosen through the endpoint while preparing.
 * 甲組 answers each unit just before 乙組 (AC-21).
 */
async function playTwoUnits(app, teacher, { mode }) {
  const { activity, units } = await createActivity(app, teacher, { units: 2 });
  assert.equal((await post(teacher, modePath(activity.id), { mode })).status, 200);
  const alpha = await joinGroup(app, activity.joinCode, '甲組');
  const beta = await joinGroup(app, activity.joinCode, '乙組');
  assert.equal((await post(teacher, api(activity.id, 'open'))).status, 200);
  const [one, two] = units;
  await submit(alpha, one, '甲組第一題');
  await submit(beta, one, '乙組第一題');
  await submit(alpha, two, '甲組第二題');
  await submit(beta, two, '乙組第二題');
  return { activity, units, alpha, beta };
}

const CSV_COLUMNS = [
  'activity_id', 'mode', 'unit_id', 'question_id', 'group_name', 'answer', 'accepted_at', 'accepted_order', 'rank', 'is_winner',
];

/** CSV rows reduced to the columns these tests compare (none of these answers contain commas). */
async function readCsv(teacher, id) {
  const response = await teacher.request(api(id, 'results.csv'));
  assert.equal(response.status, 200);
  const rows = (await response.text()).replace(/^\uFEFF/, '').trimEnd().split('\r\n').map((line) => line.split(','));
  assert.deepEqual(rows[0], CSV_COLUMNS);
  return rows.slice(1).map(([, mode, unit, question, group, , , order, rank, winner]) => [
    mode, unit, question, group, order, rank, winner,
  ]);
}

const previewOf = async (teacher, id) => (await post(teacher, `${api(id, 'sheets-export')}/preview`)).data;
const previewContents = (preview) => preview.items.map(({ questionKey, groupName, content, status }) => [
  questionKey, groupName, content, status,
]);

test('AC-23 the result page, the CSV and the write-back preview agree on a fair activity', async (t) => {
  const spreadsheet = markerSpreadsheet();
  const app = await startTestApp({ sheetsGateway: spreadsheet });
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity, alpha, beta } = await playTwoUnits(app, teacher, { mode: 'FAIR' });
  spreadsheet.load(app.db, activity.id);
  assert.equal((await close(teacher, activity.id)).status, 200);

  const results = await teacher.request(api(activity.id, 'results'));
  assert.equal(results.status, 200);
  assert.equal(results.data.activity.mode, 'FAIR');
  const [first, second] = results.data.units;
  assert.deepEqual(summary(first), [['甲組', 1, 1, true], ['乙組', 2, 2, false]]);
  assert.deepEqual(summary(second), [['乙組', 1, 2, true], ['甲組', 2, 1, false]]);
  for (const student of [alpha, beta]) assert.deepEqual((await student.request('results')).data, results.data);

  // The CSV keeps the acceptance order and the final rank apart, and marks the rank-1 group as the winner.
  assert.deepEqual(await readCsv(teacher, activity.id), [
    ['FAIR', 'Q:1', '1', '甲組', '1', '1', 'true'],
    ['FAIR', 'Q:1', '1', '乙組', '2', '2', 'false'],
    ['FAIR', 'Q:2', '2', '乙組', '2', '1', 'true'],
    ['FAIR', 'Q:2', '2', '甲組', '1', '2', 'false'],
  ]);

  // The write-back targets the rank-1 answer of every unit: 乙組 in the second unit, not the fastest 甲組.
  const preview = await previewOf(teacher, activity.id);
  assert.deepEqual(previewContents(preview), [
    ['1', '甲組', '甲組第一題', 'READY'],
    ['2', '乙組', '乙組第二題', 'READY'],
  ]);
});

test('FR-016 results, CSV and the winning answers behind the write-back stay the same after the server restarts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fair-consistency-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { PORT: '0', DATABASE_FILE: join(directory, 'buzzer.sqlite') };
  async function boot() {
    const running = await startServer({ env, logger: silentLogger });
    const baseUrl = `http://127.0.0.1:${running.server.address().port}`;
    return { ...running, baseUrl, request: (path, options) => fetch(new URL(path, baseUrl), options) };
  }
  // The write-back preview is built from the saved winners, so they are compared directly (the server
  // started here uses the real Google gateway, which the preview itself would call).
  const winners = (db, id) => JSON.parse(JSON.stringify(listWinningAnswers(db, id)));

  let saved;
  const first = await boot();
  try {
    const teacher = await makeTeacher(first);
    const { activity } = await playTwoUnits(first, teacher, { mode: 'FAIR' });
    assert.equal((await close(teacher, activity.id)).status, 200);
    saved = {
      id: activity.id,
      teacher,
      results: (await teacher.request(api(activity.id, 'results'))).data,
      csv: await readCsv(teacher, activity.id),
      winners: winners(first.db, activity.id),
    };
  } finally {
    await first.close();
  }

  const second = await boot();
  t.after(() => second.close());
  const teacher = withCookie(second, 'teacher', saved.teacher, 'buzzer_teacher');
  assert.deepEqual((await teacher.request(api(saved.id, 'results'))).data, saved.results);
  assert.deepEqual(await readCsv(teacher, saved.id), saved.csv);
  assert.deepEqual(winners(second.db, saved.id), saved.winners);
  assert.deepEqual(saved.winners.map(({ content }) => content), ['甲組第一題', '乙組第二題']);
});

test('FR-017 SC-006 a speed activity still crowns the fastest group of every unit', async (t) => {
  const spreadsheet = markerSpreadsheet();
  const app = await startTestApp({ sheetsGateway: spreadsheet });
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity } = await playTwoUnits(app, teacher, { mode: 'SPEED' });
  spreadsheet.load(app.db, activity.id);
  assert.equal((await close(teacher, activity.id)).status, 200);

  const results = await teacher.request(api(activity.id, 'results'));
  assert.equal(results.data.activity.mode, 'SPEED');
  const [first, second] = results.data.units;
  assert.deepEqual(summary(first), [['甲組', 1, 1, true], ['乙組', 2, 2, false]]);
  assert.deepEqual(summary(second), [['甲組', 1, 1, true], ['乙組', 2, 2, false]]);
  assert.deepEqual(await readCsv(teacher, activity.id), [
    ['SPEED', 'Q:1', '1', '甲組', '1', '1', 'true'],
    ['SPEED', 'Q:1', '1', '乙組', '2', '2', 'false'],
    ['SPEED', 'Q:2', '2', '甲組', '1', '1', 'true'],
    ['SPEED', 'Q:2', '2', '乙組', '2', '2', 'false'],
  ]);
  assert.deepEqual(previewContents(await previewOf(teacher, activity.id)), [
    ['1', '甲組', '甲組第一題', 'READY'],
    ['2', '甲組', '甲組第二題', 'READY'],
  ]);
});

test('SC-005 a fair activity gives students no results before it closes, and afterwards only their own activity', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity, alpha } = await playTwoUnits(app, teacher, { mode: 'FAIR' });

  const early = await alpha.request('results');
  assert.equal(early.status, 409);
  assert.equal(early.data.error.code, 'INVALID_PHASE');
  assert.doesNotMatch(JSON.stringify(early.data), /乙組|第二題/);

  assert.equal((await close(teacher, activity.id)).status, 200);
  const own = await alpha.request('results');
  assert.equal(own.status, 200);
  assert.equal(own.data.activity.id, activity.id);

  const next = await createActivity(app, teacher);
  assert.equal((await post(teacher, modePath(next.activity.id), { mode: 'FAIR' })).status, 200);
  const newcomer = await joinGroup(app, next.activity.joinCode, '丙組');
  const other = await newcomer.request('results');
  assert.equal(other.status, 409);
  assert.doesNotMatch(JSON.stringify(other.data), /甲組|乙組|第一題|第二題/);
});
