import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../../../src/server.js';
import { silentLogger } from '../../../src/lib/logger.js';
import { browser } from '../../helpers/browser.js';
import { openActivity } from '../../helpers/fixtures.js';
import { startTestApp } from '../../helpers/test-app.js';

const password = 'teacher-test-passphrase';

function configureTeacher(db) {
  const salt = Buffer.alloc(16, 7);
  db.prepare('INSERT INTO teacher_settings (id, salt, password_hash) VALUES (1, ?, ?)')
    .run(salt, scryptSync(password, salt, 64));
}

async function login(app) {
  const teacher = browser(app, 'teacher');
  await teacher.request('session');
  assert.equal((await teacher.request('login', { method: 'POST', body: { password } })).status, 200);
  return teacher;
}

test('AC-16 teacher login requires local configuration and checks Origin and CSRF', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const teacher = browser(app, 'teacher');
  const session = await teacher.request('session');
  assert.equal(session.data.setupRequired, true);
  assert.equal((await teacher.request('activities/current')).status, 401);
  const credentials = { method: 'POST', body: { password } };
  assert.equal((await teacher.request('login', credentials)).data.error.code, 'TEACHER_SETUP_REQUIRED');
  configureTeacher(app.db);
  assert.equal((await teacher.request('login', { ...credentials, headers: { Origin: 'http://example.test' } })).status, 403);
  assert.equal((await teacher.request('login', { ...credentials, headers: { Origin: '' } })).status, 403);
  assert.equal((await teacher.request('login', { ...credentials, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  const invalid = await teacher.request('login', { method: 'POST', body: { password: `${password}-wrong` } });
  assert.equal(invalid.status, 401);
  assert.doesNotMatch(JSON.stringify(invalid.data), /teacher-test-passphrase/);
  const accepted = await teacher.request('login', credentials);
  assert.equal(accepted.status, 200);
  assert.match(accepted.headers.getSetCookie()[0], /^buzzer_teacher=[A-Za-z0-9_-]{43}; .*; HttpOnly; SameSite=Strict$/i);
  const stale = await teacher.request('activities', { method: 'POST', headers: { 'X-CSRF-Token': session.data.csrfToken } });
  assert.equal(stale.status, 403);
  const oldCookie = teacher.cookies.get('buzzer_teacher');
  assert.equal((await teacher.request('logout', { method: 'POST' })).status, 200);
  teacher.cookies.set('buzzer_teacher', oldCookie);
  assert.equal((await teacher.request('activities/current')).status, 401);
});

test('AC-04 and AC-08 only preparation allows joining and a name cannot take over a group', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  configureTeacher(app.db);
  const teacher = await login(app);
  const { data: { activity }, status } = await teacher.request('activities', { method: 'POST' });
  assert.equal(status, 201);
  assert.deepEqual([activity.status, activity.mode], ['PREPARING', 'SPEED']);
  const a = browser(app, 'student');
  const b = browser(app, 'student');
  await a.request('session');
  await b.request('session');
  const join = (client, name, extra) => client.request('join', { method: 'POST', body: { joinCode: activity.joinCode, name, ...extra } });
  const joined = await join(a, '　Team A  ');
  assert.equal(joined.status, 201);
  assert.deepEqual(joined.data.group, { name: 'Team A' });
  assert.match(joined.headers.getSetCookie()[0], /^buzzer_group=[A-Za-z0-9_-]{43}; .*; HttpOnly; SameSite=Strict$/i);
  assert.equal((await join(b, 'Team A')).status, 409);
  assert.equal((await join(b, 'Team B', { groupId: 1 })).status, 400);
  assert.equal((await join(b, 'Team B')).status, 201);
  const roster = (await teacher.request('activities/current')).data.groups;
  assert.deepEqual(roster.map((group) => group.name), ['Team A', 'Team B']);
  const recovered = (await a.request('session')).data;
  assert.deepEqual(recovered.group, joined.data.group);
  assert.doesNotMatch(JSON.stringify(recovered), /Team B|joinCode|groups/);
  assert.equal((await app.request('/api/teacher/activities/current', {
    headers: { Cookie: `buzzer_group=${a.cookies.get('buzzer_group')}` },
  })).status, 401);
  openActivity(app.db, activity.id);
  const c = browser(app, 'student');
  await c.request('session');
  assert.equal((await join(c, 'Team C')).data.error.code, 'INVALID_PHASE');
  assert.equal((await a.request('session')).data.activity.status, 'OPEN');
});

test('AC-15 signed-in teacher and group resume after restarting the server', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'buzzer-session-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = { DATABASE_FILE: join(dir, 'session.sqlite'), PORT: '0' };
  async function boot() {
    const running = await startServer({ env, logger: silentLogger });
    const baseUrl = `http://127.0.0.1:${running.server.address().port}`;
    return { ...running, baseUrl, request: (path, options) => fetch(new URL(path, baseUrl), options) };
  }
  let teacherCookie;
  let studentCookie;
  let activityId;
  const first = await boot();
  try {
    configureTeacher(first.db);
    const teacher = await login(first);
    const { data: { activity } } = await teacher.request('activities', { method: 'POST' });
    activityId = activity.id;
    const student = browser(first, 'student');
    await student.request('session');
    assert.equal((await student.request('join', { method: 'POST', body: { joinCode: activity.joinCode, name: 'Restart group' } })).status, 201);
    teacherCookie = teacher.cookies.get('buzzer_teacher');
    studentCookie = student.cookies.get('buzzer_group');
  } finally {
    await first.close();
  }
  const second = await boot();
  t.after(() => second.close());
  const teacher = browser(second, 'teacher');
  teacher.cookies.set('buzzer_teacher', teacherCookie);
  const student = browser(second, 'student');
  student.cookies.set('buzzer_group', studentCookie);
  assert.equal((await teacher.request('activities/current')).data.activity.id, activityId);
  assert.equal((await student.request('session')).data.group.name, 'Restart group');
});
