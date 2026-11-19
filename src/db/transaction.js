let savepointCounter = 0;

/**
 * Runs `fn` inside a single SQLite transaction (constitution principle III).
 *
 * - The callback MUST be synchronous. Node.js runs it without interruption, so every
 *   request that goes through withTransaction is processed one at a time; this is how
 *   "close" and "submit" share one serial order (spec.md §3).
 * - Top-level calls use BEGIN IMMEDIATE; nested calls become SAVEPOINTs.
 * - Any thrown error rolls the transaction (or savepoint) back and is re-thrown.
 *
 * @template T
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {(db: import('node:sqlite').DatabaseSync) => T} fn
 * @returns {T}
 */
export function withTransaction(db, fn) {
  const nested = db.isTransaction;
  const savepoint = nested ? `sp_${(savepointCounter += 1)}` : null;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');

  try {
    const result = fn(db);
    if (isThenable(result)) {
      result.then(undefined, () => {}); // avoid an unhandled rejection; we already fail loudly
      throw new TypeError(
        'withTransaction callback must be synchronous: do not use async functions or await inside a transaction.',
      );
    }
    db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
    }
    throw error;
  }
}

function isThenable(value) {
  return value !== null && typeof value === 'object' && typeof value.then === 'function';
}
