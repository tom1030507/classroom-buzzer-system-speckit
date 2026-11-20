import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../../../src/db/connection.js';
import { migrate } from '../../../src/db/migrate.js';
import { getActivity } from '../../../src/features/activity-groups/activities.js';
import { MODES, selectMode } from '../../../src/features/fair-ranking/modes.js';
import { transitionActivity } from '../../../src/features/realtime-buzzer/state.js';
import { createFixedClock } from '../../../src/lib/time.js';
import { insertActivity, insertSingleUnit } from '../../helpers/fixtures.js';

/** A preparing activity with one imported question, so it can be opened. */
function prepare(t) {
  const db = openDatabase(':memory:');
  migrate(db);
  t.after(() => db.close());
  const deps = { db, clock: createFixedClock('2026-11-20T08:00:00.000Z') };
  const activityId = insertActivity(db);
  insertSingleUnit(db, activityId, { questionKey: '1' });
  return { db, deps, activityId };
}

const modeOf = (db, activityId) => db.prepare('SELECT mode FROM activities WHERE id = ?').get(activityId).mode;

test('MODES lists the two activity modes', () => {
  assert.deepEqual([...MODES], ['SPEED', 'FAIR']);
  assert.ok(Object.isFrozen(MODES));
});

test('FR-007 a new activity is in speed mode and the mode can change while preparing', (t) => {
  const { db, deps, activityId } = prepare(t);
  assert.equal(modeOf(db, activityId), 'SPEED');
  const before = { ...getActivity(db, activityId) };

  const fair = selectMode(deps, activityId, 'FAIR');
  assert.deepEqual({ ...fair }, { ...before, mode: 'FAIR' });
  assert.equal(modeOf(db, activityId), 'FAIR');

  assert.equal(selectMode(deps, activityId, 'SPEED').mode, 'SPEED');
  assert.equal(modeOf(db, activityId), 'SPEED');
});

test('choosing the current mode again while preparing succeeds and changes nothing', (t) => {
  const { db, deps, activityId } = prepare(t);
  selectMode(deps, activityId, 'FAIR');
  const again = selectMode(deps, activityId, 'FAIR');
  assert.equal(again.mode, 'FAIR');
  assert.equal(again.status, 'PREPARING');
  assert.equal(modeOf(db, activityId), 'FAIR');
});

test('FR-008 an open or closed activity refuses every mode change, including the same mode', (t) => {
  const { db, deps, activityId } = prepare(t);
  transitionActivity(deps, activityId, 'OPEN');
  for (const mode of ['FAIR', 'SPEED']) {
    assert.throws(() => selectMode(deps, activityId, mode), { status: 409, code: 'INVALID_PHASE' });
  }
  assert.equal(modeOf(db, activityId), 'SPEED');

  transitionActivity(deps, activityId, 'CLOSED');
  for (const mode of ['FAIR', 'SPEED']) {
    assert.throws(() => selectMode(deps, activityId, mode), { status: 409, code: 'INVALID_PHASE' });
  }
  assert.equal(modeOf(db, activityId), 'SPEED');
});

test('FR-009 a value that is not a mode is refused and the mode stays', (t) => {
  const { db, deps, activityId } = prepare(t);
  selectMode(deps, activityId, 'FAIR');
  for (const bad of ['speed', 'fair', 'FAIR ', '', null, undefined, 123, {}, ['FAIR']]) {
    assert.throws(() => selectMode(deps, activityId, bad), { status: 400, code: 'INVALID_MODE' });
  }
  assert.equal(modeOf(db, activityId), 'FAIR');
});

test('an unknown activity is a 404, and an invalid mode is refused before the lookup', (t) => {
  const { deps } = prepare(t);
  assert.throws(() => selectMode(deps, 'missing-activity', 'FAIR'), { status: 404, code: 'ACTIVITY_NOT_FOUND' });
  assert.throws(() => selectMode(deps, 'missing-activity', 'bad'), { status: 400, code: 'INVALID_MODE' });
});

test('AC-23 selecting before opening decides the mode the activity opens with, and opening locks it', (t) => {
  const { db, deps, activityId } = prepare(t);
  selectMode(deps, activityId, 'FAIR');
  assert.deepEqual(transitionActivity(deps, activityId, 'OPEN'), { id: activityId, mode: 'FAIR', status: 'OPEN' });
  assert.throws(() => selectMode(deps, activityId, 'SPEED'), { status: 409, code: 'INVALID_PHASE' });
  assert.equal(modeOf(db, activityId), 'FAIR');
});

test('AC-23 opening first refuses a later selection and keeps the mode it opened with', (t) => {
  const { db, deps, activityId } = prepare(t);
  transitionActivity(deps, activityId, 'OPEN');
  assert.throws(() => selectMode(deps, activityId, 'FAIR'), { status: 409, code: 'INVALID_PHASE' });
  assert.equal(modeOf(db, activityId), 'SPEED');
});
