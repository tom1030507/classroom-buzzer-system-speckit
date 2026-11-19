import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSheetsGateway, parseSpreadsheetId } from '../../../src/features/sheets-import/gateway.js';
import { createFixedClock } from '../../../src/lib/time.js';

const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
const clientEmail = 'import-test@example.invalid';
const privateKey = key.privateKey.export({ format: 'pem', type: 'pkcs8' });

async function credentials(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sheets-auth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const credentialsFile = join(dir, 'service-account.json');
  await writeFile(credentialsFile, JSON.stringify({ type: 'service_account', client_email: clientEmail,
    private_key: privateKey, token_uri: 'https://example.invalid/do-not-use' }));
  return credentialsFile;
}

const token = 'fake-access-token';
const tokenReply = () => Response.json({ access_token: token, expires_in: 3600 });
const isToken = (url) => new URL(url).hostname === 'oauth2.googleapis.com';

test('accepts ID and Google links with edit, gid, and account paths', () => {
  assert.equal(parseSpreadsheetId('  mock_ID-1 '), 'mock_ID-1');
  assert.equal(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/mock_ID-1/edit?usp=sharing#gid=0'), 'mock_ID-1');
  assert.equal(parseSpreadsheetId('https://docs.google.com/spreadsheets/u/0/d/mock_ID-1/edit'), 'mock_ID-1');
  for (const input of [null, '', 'mock.id', 'http://docs.google.com/spreadsheets/d/id/edit',
    'https://docs.google.com.evil.invalid/spreadsheets/d/id/edit', 'https://docs.google.com/spreadsheets/d//edit']) {
    assert.throws(() => parseSpreadsheetId(input), { code: 'INVALID_SPREADSHEET' });
  }
});

test('AC-01 request contract signs a scoped assertion and reads selected grids and merge ranges in teacher order', async (t) => {
  const calls = [];
  const clock = createFixedClock();
  const sheet1 = { properties: { sheetId: 0, title: '首頁', sheetType: 'GRID' } };
  const sheet2 = { properties: { sheetId: 21, title: '匯入', sheetType: 'GRID', gridProperties: { rowCount: 7, columnCount: 9 } },
    data: [{ startRow: 1, startColumn: 2, rowData: [{ values: [{ userEnteredValue: { stringValue: '{{Q:1}}' } }] }] }],
    merges: [{ startRowIndex: 3, endRowIndex: 5, startColumnIndex: 3, endColumnIndex: 6 }] };
  const chart = { properties: { sheetId: 99, title: '圖表', sheetType: 'OBJECT' } };
  const gateway = createSheetsGateway({ credentialsFile: await credentials(t), clock,
    fetchImpl: async (url, options) => {
      calls.push({ url: new URL(url), options });
      if (isToken(url)) return tokenReply();
      return Response.json({ sheets: [sheet1, chart, sheet2] });
    } });
  assert.deepEqual(await gateway.listSheets('spreadsheet-1'), [{ id: 0, title: '首頁' }, { id: 21, title: '匯入' }]);
  assert.deepEqual(await gateway.readSheets('spreadsheet-1', [21, 0]), [
    { id: 21, title: '匯入', gridProperties: { rowCount: 7, columnCount: 9 }, data: sheet2.data, merges: sheet2.merges },
    { id: 0, title: '首頁', gridProperties: null, data: [], merges: [] },
  ]);
  assert.equal(calls.length, 3);
  const [oauth, listing, reading] = calls;
  assert.equal(oauth.url.href, 'https://oauth2.googleapis.com/token');
  const payload = new URLSearchParams(oauth.options.body);
  assert.equal(payload.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const [header, claims, signature] = payload.get('assertion').split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), key.publicKey, Buffer.from(signature, 'base64url')), true);
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  const now = Math.floor(clock.now().getTime() / 1000);
  assert.deepEqual(JSON.parse(Buffer.from(claims, 'base64url')), {
    iss: clientEmail, aud: oauth.url.href, scope: 'https://www.googleapis.com/auth/spreadsheets',
    iat: now, exp: now + 3600,
  });
  assert.equal(listing.url.origin, 'https://sheets.googleapis.com');
  assert.equal(listing.url.pathname, '/v4/spreadsheets/spreadsheet-1');
  assert.equal(reading.url.pathname, '/v4/spreadsheets/spreadsheet-1:getByDataFilter');
  assert.match(reading.url.searchParams.get('fields'), /merges,data\(startRow,startColumn,rowData\(values\(userEnteredValue\)\)\)/);
  assert.deepEqual(JSON.parse(reading.options.body), { dataFilters: [{ gridRange: { sheetId: 21 } }, { gridRange: { sheetId: 0 } }] });
  for (const call of [listing, reading]) {
    assert.equal(call.options.headers.Authorization, `Bearer ${token}`);
    assert.equal(call.options.redirect, 'error');
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test('AC-03 maps safe permission, missing sheet, quota, network and timeout errors', async (t) => {
  const credentialsFile = await credentials(t);
  const cases = [
    [() => Response.json({ error: { message: token } }, { status: 403 }), 'SHEETS_PERMISSION'],
    [() => Response.json({ error: { message: token } }, { status: 404 }), 'SHEETS_NOT_FOUND'],
    [() => Response.json({}, { status: 429 }), 'SHEETS_QUOTA'],
    [() => Response.json({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }, { status: 403 }), 'SHEETS_QUOTA'],
    [() => { throw new TypeError(token); }, 'SHEETS_NETWORK'],
    [() => { throw new DOMException(token, 'TimeoutError'); }, 'SHEETS_TIMEOUT'],
  ];
  for (const [reply, code] of cases) {
    const gateway = createSheetsGateway({ credentialsFile, fetchImpl: async (url) => isToken(url) ? tokenReply() : reply() });
    await assert.rejects(gateway.listSheets('valid-id'), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(JSON.stringify(error.toResponseBody()), new RegExp(token));
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('AC-03 missing local credentials do not trigger external requests or expose paths', async () => {
  const file = '/nowhere/sensitive-credential-name.json';
  const gateway = createSheetsGateway({ credentialsFile: file, fetchImpl: async () => assert.fail('unexpected external request') });
  await assert.rejects(gateway.listSheets('valid-id'), (error) => error.code === 'SHEETS_CREDENTIALS' && !error.message.includes(file));
});

test('AC-03 a deleted sheet is an explicit error instead of silently importing a subset', async (t) => {
  const gateway = createSheetsGateway({ credentialsFile: await credentials(t),
    fetchImpl: async (url) => isToken(url) ? tokenReply() : Response.json({ sheets: [{ properties: { sheetId: 0, title: 'first', sheetType: 'GRID' } }] }) });
  await assert.rejects(gateway.readSheets('valid-id', [0, 10]), { code: 'SHEETS_SHEET_UNAVAILABLE' });
});
