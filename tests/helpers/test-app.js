import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { silentLogger } from '../../src/lib/logger.js';
import { createFixedClock } from '../../src/lib/time.js';

/** Fresh in-memory database with every migration applied. */
export function createTestDatabase() {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

/**
 * Starts the real Express app on an ephemeral loopback port with an in-memory database.
 * The environment is isolated from the developer's shell (process.env is not read).
 *
 * @param {{ env?: Record<string, string>, clock?: ReturnType<typeof createFixedClock>, sheetsGateway?: object }} [options]
 */
export async function startTestApp({ env = {}, clock = createFixedClock(), sheetsGateway } = {}) {
  const db = createTestDatabase();
  const config = loadConfig({ PORT: '0', DATABASE_FILE: ':memory:', ...env });
  const app = createApp({ db, config, logger: silentLogger, clock, sheetsGateway });

  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1');
    listening.once('listening', () => resolve(listening));
    listening.once('error', reject);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  return {
    db,
    app,
    server,
    clock,
    baseUrl,
    /** fetch() relative to the test server */
    request: (path, init) => fetch(new URL(path, baseUrl), init),
    async close() {
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      db.close();
    },
  };
}
