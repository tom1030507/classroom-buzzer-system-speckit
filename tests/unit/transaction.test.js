import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { openDatabase } from '../../src/db/connection.js';
import { withTransaction } from '../../src/db/transaction.js';

describe('withTransaction', () => {
  let db;
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  const insert = (value) => db.prepare('INSERT INTO items (value) VALUES (?)').run(value);

  beforeEach(() => {
    db = openDatabase(':memory:');
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL UNIQUE)');
  });

  test('commits and returns the callback result', () => {
    const result = withTransaction(db, () => {
      insert('a');
      return 'done';
    });
    assert.equal(result, 'done');
    assert.equal(count(), 1);
    assert.equal(db.isTransaction, false);
  });

  test('rolls back every statement when the callback throws', () => {
    assert.throws(
      () =>
        withTransaction(db, () => {
          insert('a');
          insert('a'); // UNIQUE violation
        }),
      /UNIQUE constraint failed/,
    );
    assert.equal(count(), 0);
    assert.equal(db.isTransaction, false);
  });

  test('rejects async callbacks before they run, so nothing is written after an await', async () => {
    let ran = false;
    assert.throws(
      () =>
        withTransaction(db, async () => {
          ran = true;
          await null;
          insert('late');
        }),
      /must be synchronous/,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(ran, false);
    assert.equal(count(), 0);
    assert.equal(db.isTransaction, false);
  });

  test('rolls back a callback that returns a promise', () => {
    assert.throws(
      () =>
        withTransaction(db, () => {
          insert('a');
          return Promise.resolve();
        }),
      /must be synchronous/,
    );
    assert.equal(count(), 0);
    assert.equal(db.isTransaction, false);
  });

  test('nested calls use savepoints: inner failure keeps outer work', () => {
    withTransaction(db, () => {
      insert('outer');
      assert.throws(() =>
        withTransaction(db, () => {
          insert('inner');
          throw new Error('inner failure');
        }),
      );
      insert('after');
    });
    const values = db.prepare('SELECT value FROM items ORDER BY id').all().map((row) => row.value);
    assert.deepEqual(values, ['outer', 'after']);
  });
});
