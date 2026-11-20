import express from 'express';
import { fileURLToPath } from 'node:url';
import { apiNotFound, errorHandler } from './http/errors.js';
import { noStore, securityHeaders } from './http/security-headers.js';
import { createActivityGroupsRouter } from './features/activity-groups/router.js';
import { createSheetsImportRouter } from './features/sheets-import/router.js';
import { createRealtimeBuzzerRouter } from './features/realtime-buzzer/router.js';
import { systemClock } from './lib/time.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/**
 * Builds the Express application. Dependencies are injected so tests can use an
 * in-memory database and a fixed clock.
 *
 * @param {{
 *   db: import('node:sqlite').DatabaseSync,
 *   config: ReturnType<typeof import('./config.js').loadConfig>,
 *   logger: ReturnType<typeof import('./lib/logger.js').createLogger>,
 *   clock?: { now: () => Date },
 *   sheetsGateway?: ReturnType<typeof import('./features/sheets-import/gateway.js').createSheetsGateway>,
 * }} deps
 */
export function createApp({ db, config, logger, clock = systemClock, sheetsGateway }) {
  const deps = Object.freeze({ db, config, logger, clock, sheetsGateway });
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders());

  const api = express.Router();
  api.use(noStore());
  // Realtime mutations authorize the session before applying route-specific JSON limits.
  api.use(createRealtimeBuzzerRouter(deps));
  api.use(express.json({ limit: '100kb' }));
  api.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // ── Feature routers ─────────────────────────────────────────────────────────
  // 每個子功能在 src/features/<slug>/ 匯出 router factory，並在此以一行掛載，例如：
  api.use(createActivityGroupsRouter(deps));
  api.use(createSheetsImportRouter(deps));
  //   api.use(createResultsExportRouter(deps));    // SF-04 004-results-export
  //   api.use(createFairRankingRouter(deps));      // SF-05 005-fair-ranking

  app.use('/api', api);
  app.use('/api', apiNotFound());
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.use(errorHandler({ logger }));
  return app;
}
