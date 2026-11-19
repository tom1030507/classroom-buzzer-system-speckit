import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { ConfigError, PROJECT_ROOT, loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  test('defaults to loopback host, port 3000 and a database under data/', () => {
    const config = loadConfig({});
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3000);
    assert.equal(config.databaseFile, path.join(PROJECT_ROOT, 'data', 'buzzer.sqlite'));
    assert.equal(config.googleCredentialsFile, null);
  });

  test('accepts only loopback hosts (spec.md §7: bind to localhost)', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      assert.equal(loadConfig({ HOST: host }).host, host);
    }
    for (const host of ['0.0.0.0', '192.168.1.20', '::', 'example.com']) {
      assert.throws(() => loadConfig({ HOST: host }), ConfigError);
    }
  });

  test('rejects invalid ports', () => {
    for (const port of ['-1', '65536', 'abc', '3.5']) {
      assert.throws(() => loadConfig({ PORT: port }), ConfigError);
    }
    assert.equal(loadConfig({ PORT: '0' }).port, 0);
  });

  test('supports an in-memory database', () => {
    assert.equal(loadConfig({ DATABASE_FILE: ':memory:' }).databaseFile, ':memory:');
  });

  test('requires Google credentials to live outside the repository', () => {
    const outside = path.join(os.tmpdir(), 'service-account.json');
    assert.equal(loadConfig({ GOOGLE_APPLICATION_CREDENTIALS: outside }).googleCredentialsFile, outside);

    const inside = path.join(PROJECT_ROOT, 'secrets', 'service-account.json');
    assert.throws(() => loadConfig({ GOOGLE_APPLICATION_CREDENTIALS: inside }), ConfigError);
  });

  test('the config object is frozen', () => {
    assert.ok(Object.isFrozen(loadConfig({})));
  });
});
