import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { openDatabase } from '../../src/db/connection.js';
import { MigrationError, migrate } from '../../src/db/migrate.js';

const BASE_TABLES = [
  'activities',
  'questions',
  'results',
  'student_groups',
  'submission_answers',
  'submissions',
  'units',
];

describe('migrate (project migrations)', () => {
  test('creates the shared base schema and is idempotent', () => {
    const db = openDatabase(':memory:');
    assert.deepEqual(migrate(db), ['000-base-schema.sql']);
    assert.deepEqual(migrate(db), []);

    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.deepEqual(tables, [...BASE_TABLES, 'schema_migrations'].sort());
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
});

describe('migrate (custom directory)', () => {
  let dir;
  let db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzzer-migrations-'));
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('applies files in name order', () => {
    fs.writeFileSync(path.join(dir, '002-02-second.sql'), "INSERT INTO log (step) VALUES ('second');");
    fs.writeFileSync(path.join(dir, '001-01-first.sql'), 'CREATE TABLE log (step TEXT);');
    assert.deepEqual(migrate(db, { dir }), ['001-01-first.sql', '002-02-second.sql']);
  });

  test('refuses a migration that changed after it was applied', () => {
    const file = path.join(dir, '001-01-table.sql');
    fs.writeFileSync(file, 'CREATE TABLE t (id INTEGER);');
    migrate(db, { dir });
    fs.writeFileSync(file, 'CREATE TABLE t (id INTEGER, extra TEXT);');
    assert.throws(() => migrate(db, { dir }), MigrationError);
  });

  test('rolls back a failing migration and does not record it', () => {
    fs.writeFileSync(path.join(dir, '001-01-broken.sql'), 'CREATE TABLE ok (id INTEGER); CREATE TABLE ok (id INTEGER);');
    assert.throws(() => migrate(db, { dir }), /already exists/);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name = 'ok'").get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 0);
  });

  test('rejects badly named migration files', () => {
    fs.writeFileSync(path.join(dir, 'Add-Table.sql'), 'SELECT 1;');
    assert.throws(() => migrate(db, { dir }), MigrationError);
  });
});
