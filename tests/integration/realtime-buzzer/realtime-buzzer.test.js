import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../../../src/server.js';
import { silentLogger } from '../../../src/lib/logger.js';
import { browser } from '../../helpers/browser.js';
import { insertActivity, insertGroupUnit, insertSingleUnit } from '../../helpers/fixtures.js';
import { startTestApp } from '../../helpers/test-app.js';

const post = (client, path, body) => client.request(path, { method: 'POST', body });
const api = (id, action) => `activities/${id}/${action}`;
const submit = (client, unitId, ...answers) => post(client, `units/${unitId}/submissions`, { answers });
const answer = (questionKey, text) => ({ questionKey, text });
const password = 'test-teacher-password';

async function makeTeacher(app) {
  const salt = Buffer.alloc(16, 13);
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

async function fixture(t, options) {
  const app = await startTestApp(options);
  t.after(() => app.close());
  const teacher = await makeTeacher(app);
  const { activity } = (await post(teacher, 'activities')).data;
  return { app, teacher, activity };
}

test('AC-04 10 student streams and the teacher synchronize a 20-question activity within two seconds', async (t) => {
  const { app, teacher, activity } = await fixture(t);
  const id = activity.id;
  assert.equal((await post(teacher, api(id, 'open'))).data.error.code, 'NO_QUESTIONS');
  const { unitId } = insertSingleUnit(app.db, id, { questionKey: 'Q1' });
  for (let index = 2; index <= 20; index += 1) insertSingleUnit(app.db, id, { questionKey: `Q${index}` });
  const students = await Promise.all(Array.from({ length: 10 }, (_, index) => joinGroup(app, activity.joinCode, `Group ${index}`)));
  assert.equal((await submit(students[0], unitId, answer('Q1', 'before opening'))).data.error.code, 'INVALID_PHASE');
  const read = await Promise.all([snapshots(t, teacher, api(id, 'events')), ...students.map((student) => snapshots(t, student, 'events'))]);
  const before = await Promise.all(read.map((next) => next()));
  assert.ok(before.every((snapshot) => snapshot.activity.status === 'PREPARING'));
  const started = performance.now();
  assert.equal((await post(teacher, api(id, 'open'))).status, 200);
  const after = await Promise.all(read.map((next) => next()));
  assert.ok(after.every((snapshot) => snapshot.activity.status === 'OPEN' && snapshot.units.length === 20));
  assert.ok(performance.now() - started < 2000);
  const finished = performance.now();
  assert.equal((await submit(students[0], unitId, answer('Q1', 'accepted'))).status, 201);
  assert.ok(performance.now() - finished < 2000);
  assert.equal((await post(teacher, api(id, 'open'))).data.error.code, 'INVALID_PHASE');
  assert.equal((await post(teacher, api(id, 'close'), { confirm: false })).data.error.code, 'CLOSE_CONFIRMATION_REQUIRED');
});

test('AC-05, AC-06, AC-07 teacher sees distinct sequence, genuine per-unit winners and unchanged retries', async (t) => {
  const { app, teacher, activity } = await fixture(t);
  const first = insertSingleUnit(app.db, activity.id, { questionKey: 'first' }).unitId;
  const second = insertSingleUnit(app.db, activity.id, { questionKey: 'second' }).unitId;
  const third = insertSingleUnit(app.db, activity.id, { questionKey: 'third' }).unitId;
  const [a, b] = await Promise.all([joinGroup(app, activity.joinCode, 'A'), joinGroup(app, activity.joinCode, 'B')]);
  await post(teacher, api(activity.id, 'open'));
  const aFirst = await submit(a, first, answer('first', 'A1'));
  await submit(b, second, answer('second', 'B2'));
  await submit(b, first, answer('first', 'B1'));
  await submit(a, second, answer('second', 'A2'));
  const simultaneous = await Promise.all([submit(a, third, answer('third', 'A3')), submit(b, third, answer('third', 'B3'))]);
  assert.ok(simultaneous.every((response) => response.status === 201));
  const retry = await submit(a, first, answer('first', 'changed'));
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data.receipt, aFirst.data.receipt);
  const { units, groups } = (await teacher.request(api(activity.id, 'live'))).data;
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  assert.deepEqual(units.slice(0, 2).map((unit) => groupNames.get(unit.winnerGroupId)), ['A', 'B']);
  assert.deepEqual(units.map((unit) => unit.submissions.length), [2, 2, 2]);
  assert.equal(units[2].submissions[0].acceptedAt, units[2].submissions[1].acceptedAt);
  assert.notEqual(units[2].submissions[0].acceptSeq, units[2].submissions[1].acceptSeq);
  assert.equal(units[2].winnerGroupId, units[2].submissions[0].groupId);
});

test('AC-09 and AC-16 student HTTP, SSE and errors disclose only its own answers', async (t) => {
  const { app, teacher, activity } = await fixture(t);
  const unit = insertSingleUnit(app.db, activity.id, { questionKey: 'Q-1' });
  const a = await joinGroup(app, activity.joinCode, 'Own group');
  const b = await joinGroup(app, activity.joinCode, 'Other private group');
  const readA = await snapshots(t, a, 'events');
  const preparation = await readA();
  assert.deepEqual(preparation, (await a.request('activity')).data);
  assert.deepEqual(preparation.units, [{ id: unit.unitId, kind: 'SINGLE', questions: [{ key: 'Q-1' }], receipt: null }]);
  const cookie = { Cookie: `buzzer_group=${a.cookies.get('buzzer_group')}` };
  for (const action of ['live', 'events']) {
    assert.equal((await app.request(`/api/teacher/${api(activity.id, action)}`, { headers: cookie })).status, 401);
  }
  await post(teacher, api(activity.id, 'open'));
  const opened = await readA();
  const errorBefore = await submit(a, unit.unitId, answer('unknown', 'fail'));
  assert.equal((await submit(b, unit.unitId, answer('Q-1', 'Private answer'))).status, 201);
  assert.deepEqual((await a.request('activity')).data, opened);
  const errorAfter = await submit(a, unit.unitId, answer('unknown', 'fail'));
  assert.deepEqual(errorAfter.data, errorBefore.data);
  const markup = '<script>plain text</script>\n';
  const response = await submit(a, unit.unitId, answer('Q-1', markup));
  assert.deepEqual(Object.keys(response.data.receipt).sort(), ['acceptedAt', 'answers', 'id', 'unitId']);
  assert.equal(response.data.receipt.answers[0].text, markup);
  const withReceipt = await readA();
  assert.deepEqual(withReceipt.units[0].receipt, response.data.receipt);
  assert.doesNotMatch(JSON.stringify(withReceipt), /Private answer|Other private group|acceptSeq|winnerGroupId|joinCode|groups/);
  const readAfterReconnect = await snapshots(t, a, 'events');
  assert.deepEqual(await readAfterReconnect(), withReceipt);
});

test('AC-10 and AC-18 close and an atomic group submission share the same server order', async (t) => {
  const { app, teacher, activity } = await fixture(t);
  const unit = insertGroupUnit(app.db, activity.id, { groupCode: 'G', questions: [{ questionKey: '1' }, { questionKey: '2' }] });
  const a = await joinGroup(app, activity.joinCode, 'A');
  const b = await joinGroup(app, activity.joinCode, 'B');
  await post(teacher, api(activity.id, 'open'));
  const wrong = await submit(a, unit.unitId, answer('1', 'only one'));
  assert.equal(wrong.status, 400);
  const answers = [answer('1', 'first'), answer('2', 'second')];
  const accepted = await Promise.all([submit(a, unit.unitId, ...answers), submit(a, unit.unitId, ...answers)]);
  assert.deepEqual(accepted.map((response) => response.status).sort(), [200, 201]);
  assert.deepEqual(accepted[0].data.receipt, accepted[1].data.receipt);
  const [attempt, close] = await Promise.all([
    submit(b, unit.unitId, ...answers),
    post(teacher, api(activity.id, 'close'), { confirm: true }),
  ]);
  assert.equal(close.status, 200);
  const count = attempt.status === 201 ? 2 : 1;
  if (attempt.status !== 201) assert.equal(attempt.data.error.code, 'INVALID_PHASE');
  assert.equal((await submit(b, unit.unitId, ...answers)).data.error.code, 'INVALID_PHASE');
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM submissions').get().n, count);
  assert.equal(app.db.prepare('SELECT count(*) AS n FROM submission_answers').get().n, count * 2);
  assert.equal((await a.request('activity')).data.activity.status, 'CLOSED');
});

test('AC-15 restarting restores phase and the same receipt without recording another submission', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'buzzer-restart-'));
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
    const id = insertActivity(first.db, { joinCode: 'RESTART' });
    const { unitId } = insertSingleUnit(first.db, id, { questionKey: 'restart' });
    const student = await joinGroup(first, 'RESTART', 'Persistent group');
    await post(teacher, api(id, 'open'));
    const response = await submit(student, unitId, answer('restart', 'original'));
    assert.equal(response.status, 201);
    saved = { unitId, receipt: response.data.receipt, cookie: student.cookies.get('buzzer_group') };
  } finally {
    await first.close();
  }
  const second = await boot();
  t.after(() => second.close());
  const student = browser(second, 'student');
  student.cookies.set('buzzer_group', saved.cookie);
  await student.request('session');
  const read = await snapshots(t, student, 'events');
  const activity = await read();
  assert.equal(activity.activity.status, 'OPEN');
  assert.deepEqual(activity.units[0].receipt, saved.receipt);
  const retry = await submit(student, saved.unitId, answer('restart', 'duplicate'));
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.data.receipt, saved.receipt);
  assert.equal(second.db.prepare('SELECT count(*) AS n FROM submissions').get().n, 1);
});

test('a teacher tab with an older cell mapping cannot open a different import', async (t) => {
  const { app, teacher, activity } = await fixture(t);
  const id = activity.id;
  insertSingleUnit(app.db, id, { questionKey: 'Q1' });
  const older = (await teacher.request(api(id, 'live'))).data;
  app.db.prepare('UPDATE questions SET row_index = row_index + 1 WHERE activity_id = ?').run(id);
  assert.equal(typeof older.importRevision, 'string');
  const stale = await post(teacher, api(id, 'open'), { importRevision: older.importRevision });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, 'IMPORT_CHANGED');
  const newer = (await teacher.request(api(id, 'live'))).data;
  assert.notEqual(older.importRevision, newer.importRevision);
  assert.equal(newer.imported.units[0].questions[0].rowIndex, older.imported.units[0].questions[0].rowIndex + 1);
  assert.equal((await post(teacher, api(id, 'open'), { importRevision: newer.importRevision })).status, 200);
});

test('a valid large group can submit every answer at the documented Unicode limit', async (t) => {
  const { app, teacher, activity } = await fixture(t);
  const questions = Array.from({ length: 261 }, (_, index) => ({ questionKey: `Q${index}` }));
  const { unitId } = insertGroupUnit(app.db, activity.id, { groupCode: 'large', questions });
  const student = await joinGroup(app, activity.joinCode, 'Large group');
  await post(teacher, api(activity.id, 'open'));
  const response = await submit(student, unitId, ...questions.map(({ questionKey }) => answer(questionKey, '😀'.repeat(1000))));
  assert.equal(response.status, 201);
  assert.equal(response.data.receipt.answers.length, 261);
});
