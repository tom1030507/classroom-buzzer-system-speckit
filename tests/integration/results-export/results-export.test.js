import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../../../src/server.js';
import { silentLogger } from '../../../src/lib/logger.js';
import { browser } from '../../helpers/browser.js';
import { insertGroupUnit, insertSingleUnit } from '../../helpers/fixtures.js';
import { startTestApp } from '../../helpers/test-app.js';

const password = 'results-teacher-password';
const post = (client, path, body = {}) => client.request(path, { method: 'POST', body });
const api = (id, action) => `activities/${id}/${action}`;
const answer = (questionKey, text) => ({ questionKey, text });

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
 * Question 1: 甲組 first, 乙組 second. Group A (questions 2–4): 乙組 only.
 * Question 5: nobody answers.
 */
async function playActivity(app, teacher) {
  const { activity } = (await post(teacher, 'activities')).data;
  const single = insertSingleUnit(app.db, activity.id, { questionKey: '1' });
  const grouped = insertGroupUnit(app.db, activity.id, {
    groupCode: 'A', questions: [{ questionKey: '2' }, { questionKey: '3' }, { questionKey: '4' }],
  });
  insertSingleUnit(app.db, activity.id, { questionKey: '5' });
  const alpha = await joinGroup(app, activity.joinCode, '甲組');
  const beta = await joinGroup(app, activity.joinCode, '乙組');
  assert.equal((await post(teacher, api(activity.id, 'open'))).status, 200);
  const submit = async (student, unitId, ...answers) => {
    assert.equal((await post(student, `units/${unitId}/submissions`, { answers })).status, 201);
  };
  await submit(alpha, single.unitId, answer('1', '光合作用'));
  await submit(beta, grouped.unitId, answer('2', '葉綠體'), answer('3', '二氧化碳'), answer('4', '氧氣'));
  await submit(beta, single.unitId, answer('1', '呼吸作用'));
  return { activity, alpha, beta };
}

const close = (teacher, id) => post(teacher, api(id, 'close'), { confirm: true });

async function fixture(t) {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  return { app, teacher, ...(await playActivity(app, teacher)) };
}

test('AC-11 after closing, the teacher and every group read the same fixed results', async (t) => {
  const { teacher, activity, alpha, beta } = await fixture(t);
  const id = activity.id;

  const early = await alpha.request('results');
  assert.equal(early.status, 409);
  assert.equal(early.data.error.code, 'INVALID_PHASE');
  assert.doesNotMatch(JSON.stringify(early.data), /乙組|呼吸作用|葉綠體/);
  assert.equal((await teacher.request(api(id, 'results'))).data.error.code, 'INVALID_PHASE');

  assert.equal((await close(teacher, id)).status, 200);
  const results = await teacher.request(api(id, 'results'));
  assert.equal(results.status, 200);
  const { activity: summary, units } = results.data;
  assert.equal(summary.mode, 'SPEED');
  assert.equal(summary.status, 'CLOSED');
  assert.deepEqual(units.map(({ label, noAnswer }) => [label, noAnswer]), [['Q:1', false], ['G:A', false], ['Q:5', true]]);
  assert.deepEqual(units[0].entries.map(({ groupName, rank, isWinner, answers }) => [groupName, rank, isWinner, answers[0].text]), [
    ['甲組', 1, true, '光合作用'],
    ['乙組', 2, false, '呼吸作用'],
  ]);
  assert.deepEqual(units[1].entries[0].answers.map(({ text }) => text), ['葉綠體', '二氧化碳', '氧氣']);

  for (const student of [alpha, beta]) {
    const seen = await student.request('results');
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.data, results.data);
  }
});

test('only the teacher reads results by activity, and students only read their own activity', async (t) => {
  const { app, teacher, activity, alpha } = await fixture(t);
  await close(teacher, activity.id);

  const intruder = withCookie(app, 'teacher', alpha, 'buzzer_group');
  assert.equal((await intruder.request(api(activity.id, 'results'))).status, 401);
  assert.equal((await browser(app, 'teacher').request(api(activity.id, 'results'))).status, 401);
  assert.equal((await browser(app, 'student').request('results')).data.error.code, 'GROUP_REQUIRED');
  assert.equal((await teacher.request(api('missing-activity', 'results'))).status, 404);

  const { activity: next } = (await post(teacher, 'activities')).data;
  const newcomer = await joinGroup(app, next.joinCode, '丙組');
  const other = await newcomer.request('results');
  assert.equal(other.status, 409);
  assert.doesNotMatch(JSON.stringify(other.data), /甲組|乙組|光合作用/);
});

test('AC-15 results stay the same after the server restarts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'results-restart-'));
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
    const { activity, alpha } = await playActivity(first, teacher);
    await close(teacher, activity.id);
    const read = await teacher.request(api(activity.id, 'results'));
    assert.equal(read.status, 200);
    assert.equal(read.data.units.length, 3);
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
  }
});
