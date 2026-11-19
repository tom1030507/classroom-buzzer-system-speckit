import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowIso } from '../lib/time.js';
import { withTransaction } from './transaction.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** e.g. 000-base-schema.sql, 001-01-sessions.sql (see migrations/README.md) */
const MIGRATION_FILE = /^\d{3}-[a-z0-9][a-z0-9-]*\.sql$/;

export class MigrationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * Applies every pending migration in file-name order, each in its own transaction.
 * Applied migrations are recorded with a checksum; editing an applied file is an error
 * (create a new migration instead).
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ dir?: string, clock?: { now: () => Date } }} [options]
 * @returns {string[]} names of the migrations applied by this call
 */
export function migrate(db, { dir = MIGRATIONS_DIR, clock } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Map(
    db.prepare('SELECT name, checksum FROM schema_migrations').all().map((row) => [row.name, row.checksum]),
  );
  const appliedNow = [];

  for (const name of listMigrationFiles(dir)) {
    const sql = fs.readFileSync(path.join(dir, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');

    if (applied.has(name)) {
      if (applied.get(name) !== checksum) {
        throw new MigrationError(
          `Migration ${name} was modified after it was applied. Add a new migration instead; ` +
            'for a local development database you may delete the database file and restart.',
        );
      }
      continue;
    }

    withTransaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)').run(
        name,
        checksum,
        nowIso(clock),
      );
    });
    appliedNow.push(name);
  }

  return appliedNow;
}

function listMigrationFiles(dir) {
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.sql'));
  const invalid = files.filter((name) => !MIGRATION_FILE.test(name));
  if (invalid.length > 0) {
    throw new MigrationError(
      `Invalid migration file name(s): ${invalid.join(', ')}. Expected NNN-description.sql.`,
    );
  }
  return files.sort();
}
