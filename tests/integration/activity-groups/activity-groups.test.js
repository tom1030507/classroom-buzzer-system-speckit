import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../../../src/server.js';
import { silentLogger } from '../../../src/lib/logger.js';
import { browser } from '../../helpers/browser.js';
import {
  closeActivity, insertActivity, insertSingleUnit, insertSubmission, openActivity,
} from '../../helpers/fixtures.js';
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

test('teacher can still reach every unfinished activity left by earlier data', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  configureTeacher(app.db);
  const teacher = await login(app);
  const first = insertActivity(app.db, { joinCode: 'EARLIER1' });
  const second = insertActivity(app.db, { joinCode: 'EARLIER2' });
  openActivity(app.db, first);
  const { activity, availableActivities } = (await teacher.request('activities/current')).data;
  assert.equal(activity.id, second);
  assert.deepEqual(availableActivities.map(({ id }) => id), [second, first]);
  assert.equal((await teacher.request(`activities/${first}`)).data.activity.status, 'OPEN');
});

test('AC-24 a teacher has at most one unfinished activity, across sessions, until it closes', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  configureTeacher(app.db);
  const teacher = await login(app);
  const otherSession = await login(app);
  const create = (client) => client.request('activities', { method: 'POST' });
  const count = () => app.db.prepare('SELECT count(*) AS n FROM activities').get().n;

  const first = await create(teacher);
  assert.equal(first.status, 201);
  for (const advance of [() => {}, () => openActivity(app.db, first.data.activity.id)]) {
    advance();
    for (const client of [teacher, otherSession]) {
      const refused = await create(client);
      assert.equal(refused.status, 409);
      assert.equal(refused.data.error.code, 'ACTIVITY_UNFINISHED');
    }
  }
  assert.equal(count(), 1);

  closeActivity(app.db, first.data.activity.id);
  const next = await create(otherSession);
  assert.equal(next.status, 201);
  assert.notEqual(next.data.activity.id, first.data.activity.id);
  assert.equal(count(), 2);
});

test('AC-24 two sessions creating at the same moment leave exactly one activity', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  configureTeacher(app.db);
  const teachers = [await login(app), await login(app)];
  for (let round = 0; round < 10; round += 1) {
    const responses = await Promise.all(teachers.map((client) => client.request('activities', { method: 'POST' })));
    assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
    const unfinished = app.db.prepare("SELECT id FROM activities WHERE status <> 'CLOSED'").all();
    assert.equal(unfinished.length, 1);
    openActivity(app.db, unfinished[0].id);
    closeActivity(app.db, unfinished[0].id);
  }
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM activities').get().n, 10);
});

test('AC-24 join codes are six characters without the easily confused 0, O, 1 and I', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  configureTeacher(app.db);
  const teacher = await login(app);
  const codes = [];
  for (let round = 0; round < 100; round += 1) {
    const { data: { activity } } = await teacher.request('activities', { method: 'POST' });
    codes.push(activity.joinCode);
    openActivity(app.db, activity.id);
    closeActivity(app.db, activity.id);
  }
  for (const code of codes) assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(new Set(codes).size, codes.length);
  assert.ok(new Set(codes.join('')).size > 16, 'codes use more than the sixteen hexadecimal characters');
});

test('AC-24 a group name is 1 to 30 Unicode characters after trimming', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  insertActivity(app.db, { joinCode: 'NAMES1' });
  const attempt = async (name) => {
    const student = browser(app, 'student');
    await student.request('session');
    return student.request('join', { method: 'POST', body: { joinCode: 'NAMES1', name } });
  };
  const names = () => app.db.prepare('SELECT name FROM student_groups ORDER BY id').all().map(({ name }) => name);

  for (const name of ['', '   ', '\u3000\u3000', '甲'.repeat(31), '😀'.repeat(31)]) {
    const refused = await attempt(name);
    assert.equal(refused.status, 400, JSON.stringify(name));
    assert.equal(refused.data.error.code, 'INVALID_JOIN');
    assert.match(refused.data.error.message, /30/);
  }
  assert.deepEqual(names(), []);

  const accepted = ['甲', '乙'.repeat(30), '😀'.repeat(30)];
  for (const name of accepted) assert.equal((await attempt(name)).status, 201, name);
  assert.equal((await attempt(`\u3000 ${'丙'.repeat(30)} `)).status, 201);
  assert.deepEqual(names(), [...accepted, '丙'.repeat(30)]);
});

test('AC-24 groups joining with the same name at the same moment: only one succeeds', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  insertActivity(app.db, { joinCode: 'SAME22' });
  const students = Array.from({ length: 5 }, () => browser(app, 'student'));
  await Promise.all(students.map((student) => student.request('session')));
  const responses = await Promise.all(students.map((student) => student.request('join', {
    method: 'POST', body: { joinCode: 'SAME22', name: '同名組' },
  })));
  assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409, 409, 409, 409]);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM student_groups').get().n, 1);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM group_sessions').get().n, 1);
});

test('the original browser can retry a join whose session cookie was lost', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  configureTeacher(app.db);
  const teacher = await login(app);
  const { activity } = (await teacher.request('activities', { method: 'POST' })).data;
  const student = browser(app, 'student');
  const bootstrap = await student.request('session');
  const headers = {
    Cookie: `buzzer_group_bootstrap=${student.cookies.get('buzzer_group_bootstrap')}`,
    'Content-Type': 'application/json', Origin: app.baseUrl,
    'X-CSRF-Token': bootstrap.data.csrfToken,
  };
  const join = (name) => app.request('/api/student/join', {
    method: 'POST', headers, body: JSON.stringify({ joinCode: activity.joinCode, name }),
  });
  const first = await join('Transport retry');
  assert.equal(first.status, 201);
  openActivity(app.db, activity.id);
  const retry = await join('Transport retry');
  assert.equal(retry.status, 201);
  assert.equal(first.headers.getSetCookie()[0].split(';')[0], retry.headers.getSetCookie()[0].split(';')[0]);
  assert.equal((await join('Different name')).status, 409);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM student_groups').get().n, 1);
});

async function joinAsStudent(app, joinCode, name) {
  const student = browser(app, 'student');
  await student.request('session');
  const response = await student.request('join', { method: 'POST', body: { joinCode, name } });
  assert.equal(response.status, 201);
  return student;
}

test('AC-25 leaving preparation removes only the current group and lets the same browser join again', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  configureTeacher(app.db);
  const teacher = await login(app);
  const initial = (await teacher.request('activities', { method: 'POST' })).data.activity;
  const leaving = await joinAsStudent(app, initial.joinCode, 'Leaving group');
  const staying = await joinAsStudent(app, initial.joinCode, 'Staying group');
  const previous = await leaving.request('session');
  const stale = browser(app, 'student');
  stale.cookies.set('buzzer_group', leaving.cookies.get('buzzer_group'));
  leaving.cookies.set('buzzer_group_bootstrap', 'A'.repeat(43));

  const left = await leaving.request('leave', { method: 'POST' });
  assert.equal(left.status, 200);
  assert.equal(left.data.group, null);
  assert.equal(left.data.activity, null);
  assert.match(left.data.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(left.data.csrfToken, previous.data.csrfToken);
  assert.equal(leaving.cookies.has('buzzer_group'), false);
  assert.notEqual(leaving.cookies.get('buzzer_group_bootstrap'), 'A'.repeat(43));
  assert.equal((await stale.request('session')).data.group, null);
  assert.equal((await stale.request('leave', { method: 'POST' })).status, 401);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM group_sessions').get().n, 1);
  const roster = (await teacher.request(`activities/${initial.id}`)).data.groups;
  assert.deepEqual(roster.map(({ name }) => name), ['Staying group']);
  assert.equal((await staying.request('session')).data.group.name, 'Staying group');

  const rejoined = await leaving.request('join', {
    method: 'POST', body: { joinCode: initial.joinCode, name: 'Renamed group' },
  });
  assert.equal(rejoined.status, 201);
  assert.equal(rejoined.data.activity.id, initial.id);
  assert.deepEqual((await teacher.request(`activities/${initial.id}`)).data.groups.map(({ name }) => name),
    ['Staying group', 'Renamed group']);
});

test('AC-25 leaving requires the active group Cookie, same Origin and its CSRF token', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  insertActivity(app.db, { joinCode: 'AUTHJOIN' });
  const student = await joinAsStudent(app, 'AUTHJOIN', 'Authorized group');
  const anonymous = browser(app, 'student');
  await anonymous.request('session');

  assert.equal((await anonymous.request('leave', { method: 'POST' })).data.error.code, 'GROUP_REQUIRED');
  assert.equal((await student.request('leave', {
    method: 'POST', headers: { Origin: 'http://example.test' },
  })).data.error.code, 'INVALID_ORIGIN');
  assert.equal((await student.request('leave', {
    method: 'POST', headers: { 'X-CSRF-Token': '' },
  })).data.error.code, 'INVALID_CSRF');
  assert.equal((await student.request('session')).data.group.name, 'Authorized group');
});

test('AC-25 leaving rejects a stale preparation page after opening or closing and keeps accepted answers', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const activityId = insertActivity(app.db, { joinCode: 'PHASEJOIN' });
  const { unitId, questionId } = insertSingleUnit(app.db, activityId, { questionKey: '1' });
  const student = await joinAsStudent(app, 'PHASEJOIN', 'Phase group');
  const { id: groupId } = app.db.prepare('SELECT id FROM student_groups').get();
  const phases = [[openActivity, 'OPEN'], [closeActivity, 'CLOSED']];
  for (const [advance, status] of phases) {
    advance(app.db, activityId);
    if (status === 'OPEN') {
      insertSubmission(app.db, { activityId, unitId, groupId, acceptSeq: 1, answers: [{ questionId, text: 'kept' }] });
    }
    const response = await student.request('leave', { method: 'POST' });
    assert.equal(response.status, 409);
    assert.equal(response.data.error.code, 'INVALID_PHASE');
    const session = (await student.request('session')).data;
    assert.equal(session.group.name, 'Phase group');
    assert.equal(session.activity.status, status);
    assert.deepEqual(app.db.prepare('SELECT answer_text AS text FROM submission_answers').all().map(({ text }) => text),
      ['kept']);
  }
});

test('AC-25 leaving and opening at the same moment end in exactly one consistent state', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  configureTeacher(app.db);
  const teacher = await login(app);
  // Records the phase each group was deleted in, whichever request the server handled first.
  app.db.exec(`CREATE TEMP TABLE left_during (status TEXT);
    CREATE TEMP TRIGGER record_leave AFTER DELETE ON student_groups BEGIN
      INSERT INTO left_during SELECT status FROM activities WHERE id = OLD.activity_id;
    END;`);
  for (let round = 0; round < 20; round += 1) {
    const activityId = insertActivity(app.db, { joinCode: `RACE${round}` });
    insertSingleUnit(app.db, activityId, { questionKey: '1' });
    const student = await joinAsStudent(app, `RACE${round}`, 'Racing group');
    const { importRevision } = (await teacher.request(`activities/${activityId}/live`)).data;
    const leave = () => student.request('leave', { method: 'POST' });
    const open = () => teacher.request(`activities/${activityId}/open`, { method: 'POST', body: { importRevision } });
    // In every other round the opening request gets a head start, so both server orders occur.
    const headStart = round % 2 ? open() : null;
    if (headStart) await delay(round % 8);
    const [left, opened] = await Promise.all([leave(), headStart ?? open()]);

    assert.equal(opened.status, 200);
    const { n } = app.db.prepare('SELECT count(*) AS n FROM student_groups WHERE activity_id = ?').get(activityId);
    const session = (await student.request('session')).data;
    if (left.status === 200) {
      assert.equal(n, 0);
      assert.equal(session.group, null);
    } else {
      assert.equal(left.status, 409);
      assert.equal(left.data.error.code, 'INVALID_PHASE');
      assert.equal(n, 1);
      assert.equal(session.group.name, 'Racing group');
    }
  }
  const outside = app.db.prepare("SELECT count(*) AS n FROM left_during WHERE status <> 'PREPARING'").get().n;
  assert.equal(outside, 0);
});

test('AC-25 the live stream of a group that left ends without showing the activity again', async (t) => {
  const app = await startTestApp();
  t.after(() => app.close());
  const activityId = insertActivity(app.db, { joinCode: 'LEAVELIVE' });
  insertSingleUnit(app.db, activityId, { questionKey: '1' });
  const student = await joinAsStudent(app, 'LEAVELIVE', 'Streaming group');
  const stale = browser(app, 'student');
  stale.cookies.set('buzzer_group', student.cookies.get('buzzer_group'));
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await stale.request('events', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]) });
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  assert.match((await reader.read()).value, /^event: snapshot\n/);

  assert.equal((await student.request('leave', { method: 'POST' })).status, 200);
  openActivity(app.db, activityId); // a stream that survived would now report the new phase
  let later = '';
  for (let message = await reader.read(); !message.done; message = await reader.read()) later += message.value;
  assert.doesNotMatch(later, /event: snapshot/);
  assert.equal((await stale.request('events')).status, 401);
});
