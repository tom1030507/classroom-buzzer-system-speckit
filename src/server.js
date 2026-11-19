import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { createLogger } from './lib/logger.js';
import { systemClock } from './lib/time.js';

/**
 * Opens the database, applies migrations and starts listening on the loopback interface.
 *
 * @param {{ env?: Record<string, string | undefined>, logger?: ReturnType<typeof createLogger> }} [options]
 */
export async function startServer({ env = process.env, logger = createLogger() } = {}) {
  const config = loadConfig(env);
  const db = openDatabase(config.databaseFile);

  try {
    const applied = migrate(db);
    if (applied.length > 0) logger.info('Applied database migrations', { migrations: applied });

    const app = createApp({ db, config, logger, clock: systemClock });
    const server = await listen(app, config.port, config.host);
    const { address, port } = server.address();
    logger.info(`Classroom buzzer listening on http://${formatHost(address)}:${port}`);

    return {
      server,
      db,
      config,
      async close() {
        await new Promise((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections(); // also ends long-lived SSE connections
        });
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

function listen(app, port, host) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    server.once('listening', () => resolve(server));
    server.once('error', reject);
  });
}

function formatHost(address) {
  return address.includes(':') ? `[${address}]` : address;
}

async function main() {
  const logger = createLogger();
  let running;
  try {
    running = await startServer({ logger });
  } catch (error) {
    logger.error(`Failed to start: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down`);
    await running.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await main();
}
