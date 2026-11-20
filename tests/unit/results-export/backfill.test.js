import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../../../src/db/connection.js';
import { MIGRATIONS_DIR, migrate } from '../../../src/db/migrate.js';
import {
  closeActivity, insertActivity, insertGroup, insertSingleUnit, insertSubmission, openActivity,
} from '../../helpers/fixtures.js';

/** A database migrated up to everything before SF-04, as it was before this feature shipped. */
function databaseBeforeSf04(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf04-migrations-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of fs.readdirSync(MIGRATIONS_DIR)) {
    if (name.endsWith('.sql') && !name.startsWith('004-')) {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, name), path.join(dir, name));
    }
  }
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  migrate(db, { dir });
  return db;
}

/** One single-question unit answered by two groups, Beta accepted before Alpha. */
function answeredActivity(db, { mode = 'SPEED', close = true } = {}) {
  const activityId = insertActivity(db, { mode });
  const alpha = insertGroup(db, activityId, 'Alpha');
  const beta = insertGroup(db, activityId, 'Beta');
  const { unitId, questionId } = insertSingleUnit(db, activityId, { questionKey: '1' });
  openActivity(db, activityId);
  const answer = (groupId, acceptSeq) => insertSubmission(db, {
    activityId, unitId, groupId, acceptSeq, answers: [{ questionId, text: `answer ${acceptSeq}` }],
  });
  const later = answer(alpha, 5);
  const earlier = answer(beta, 2);
  if (close) closeActivity(db, activityId);
  return { activityId, unitId, earlier, later };
}

const resultRows = (db, activityId) => db.prepare(`
  SELECT r.submission_id, r.final_rank, r.is_winner
  FROM results AS r JOIN submissions AS s ON s.id = r.submission_id
  WHERE s.activity_id = ? ORDER BY r.final_rank
`).all(activityId).map((row) => Object.values(row));

test('migration 004-01 backfills speed results for activities closed before SF-04 and leaves the rest alone', (t) => {
  const db = databaseBeforeSf04(t);
  const legacy = answeredActivity(db);
  const fair = answeredActivity(db, { mode: 'FAIR' });
  const stillOpen = answeredActivity(db, { close: false });
  const alreadyRanked = answeredActivity(db);
  db.prepare('INSERT INTO results (submission_id, unit_id, final_rank, is_winner) VALUES (?, ?, 1, 1)')
    .run(alreadyRanked.later, alreadyRanked.unitId);
  db.prepare('INSERT INTO results (submission_id, unit_id, final_rank, is_winner) VALUES (?, ?, 2, 0)')
    .run(alreadyRanked.earlier, alreadyRanked.unitId);

  assert.ok(migrate(db).includes('004-01-backfill-speed-results.sql'));

  assert.deepEqual(resultRows(db, legacy.activityId), [[legacy.earlier, 1, 1], [legacy.later, 2, 0]]);
  assert.deepEqual(resultRows(db, fair.activityId), []);
  assert.deepEqual(resultRows(db, stillOpen.activityId), []);
  assert.deepEqual(resultRows(db, alreadyRanked.activityId), [[alreadyRanked.later, 1, 1], [alreadyRanked.earlier, 2, 0]]);
});
