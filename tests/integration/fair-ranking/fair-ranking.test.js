import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../../../src/server.js';
import { silentLogger } from '../../../src/lib/logger.js';
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

/**
 * Creates an activity with single-question units "1", "2", … and two groups (甲組, 乙組), then opens it.
 * The mode is set directly in the database while the activity is still PREPARING, because the mode
 * endpoint arrives with user story 2.
 */
async function openActivity(app, teacher, { units: unitCount = 2, mode = 'FAIR' } = {}) {
  const { activity } = (await post(teacher, 'activities')).data;
  app.db.prepare('UPDATE activities SET mode = ? WHERE id = ?').run(mode, activity.id);
  const units = Array.from({ length: unitCount }, (_, index) => {
    const key = String(index + 1);
    return { ...insertSingleUnit(app.db, activity.id, { questionKey: key }), key };
  });
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
