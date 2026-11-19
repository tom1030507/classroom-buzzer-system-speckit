import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { startTestApp } from '../helpers/test-app.js';

describe('HTTP application', () => {
  let app;
  before(async () => {
    app = await startTestApp();
  });
  after(async () => {
    await app.close();
  });

  test('GET /api/health answers with JSON and no-store caching', async () => {
    const response = await app.request('/api/health');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  test('every response carries the security headers', async () => {
    const response = await app.request('/');
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('x-powered-by'), null);
  });

  test('unknown API routes answer with the standard JSON error', async () => {
    const response = await app.request('/api/does-not-exist');
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: { code: 'NOT_FOUND', message: '找不到這個 API。' } });
  });

  test('malformed JSON bodies are rejected with INVALID_JSON', async () => {
    const response = await app.request('/api/health', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"broken": ',
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_JSON');
  });

  test('serves the landing, teacher and student pages', async () => {
    for (const path of ['/', '/teacher/', '/student/']) {
      const response = await app.request(path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.match(await response.text(), /課堂搶答系統/);
    }
  });
});
