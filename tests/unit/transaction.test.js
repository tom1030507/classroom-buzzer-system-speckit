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

  test('rejects async callbacks and rolls back', () => {
    assert.throws(
      () =>
        withTransaction(db, async () => {
          insert('a');
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
