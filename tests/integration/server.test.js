import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ConfigError } from '../../src/config.js';
import { silentLogger } from '../../src/lib/logger.js';
import { startServer } from '../../src/server.js';

describe('startServer', () => {
  test('binds to the loopback interface only (spec.md §7)', async () => {
    const running = await startServer({
      env: { PORT: '0', DATABASE_FILE: ':memory:' },
      logger: silentLogger,
    });
    try {
      assert.equal(running.server.address().address, '127.0.0.1');
      const response = await fetch(`http://127.0.0.1:${running.server.address().port}/api/health`);
      assert.equal(response.status, 200);
    } finally {
      await running.close();
    }
  });

  test('refuses to start on a non-loopback host', async () => {
    await assert.rejects(
      startServer({ env: { HOST: '0.0.0.0', PORT: '0', DATABASE_FILE: ':memory:' }, logger: silentLogger }),
      ConfigError,
    );
  });
});
