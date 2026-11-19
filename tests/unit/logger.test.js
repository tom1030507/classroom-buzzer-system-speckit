import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createLogger, redact } from '../../src/lib/logger.js';

describe('redact', () => {
  test('masks secret-looking keys at any depth', () => {
    const result = redact({
      user: 'teacher',
      password: 'hunter2',
      nested: { sessionId: 'abc', csrfToken: 'xyz', list: [{ private_key: 'pem' }] },
    });
    assert.deepEqual(result, {
      user: 'teacher',
      password: '[REDACTED]',
      nested: { sessionId: '[REDACTED]', csrfToken: '[REDACTED]', list: [{ private_key: '[REDACTED]' }] },
    });
  });

  test('serialises errors to name, message and stack', () => {
    const result = redact(new Error('boom'));
    assert.equal(result.name, 'Error');
    assert.equal(result.message, 'boom');
    assert.match(result.stack, /boom/);
  });
});

describe('createLogger', () => {
  test('writes redacted metadata and respects the level threshold', () => {
    const lines = [];
    const sink = { log: (line) => lines.push(line), error: (line) => lines.push(line) };
    const logger = createLogger({ level: 'info', sink });

    logger.debug('hidden');
    logger.info('login', { password: 'secret' });

    assert.equal(lines.length, 1);
    assert.match(lines[0], /INFO login/);
    assert.match(lines[0], /\[REDACTED\]/);
    assert.doesNotMatch(lines[0], /secret"/);
  });
});
