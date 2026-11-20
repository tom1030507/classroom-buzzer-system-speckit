import { sign } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from '../../config.js';
import { AppError, badRequest } from '../../lib/errors.js';
import { systemClock } from '../../lib/time.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_URI = 'https://sheets.googleapis.com/v4/spreadsheets/';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const LINK_PATTERN = /^\/spreadsheets\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)(?:\/|$)/;
const LIST_FIELDS = 'sheets(properties(sheetId,title,sheetType))';
const GRID_FIELDS = 'sheets(properties(sheetId,title,sheetType,gridProperties),merges,data(startRow,startColumn,rowData(values(userEnteredValue))))';
const STRUCTURE_FIELDS = 'sheets(properties(sheetId,title,sheetType,gridProperties),merges)';
const CELL_FIELDS = 'sheets(properties(sheetId),data(startRow,startColumn,rowData(values(userEnteredValue))))';

const cellKey = (sheetId, rowIndex, columnIndex) => `${sheetId}:${rowIndex}:${columnIndex}`;
const cellRange = ({ sheetId, rowIndex, columnIndex }) => ({
  sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1,
});

export function parseSpreadsheetId(input) {
  if (typeof input === 'string') {
    const value = input.trim();
    if (ID_PATTERN.test(value)) return value;
    const url = URL.parse(value);
    if (url?.origin === 'https://docs.google.com' && !url.username && !url.password) {
      const id = LINK_PATTERN.exec(url.pathname)?.[1];
      if (id) return id;
    }
  }
  throw badRequest('INVALID_SPREADSHEET', '請輸入有效的 Google 試算表網址或 ID。');
}

function credentialError() {
  return new AppError(503, 'SHEETS_CREDENTIALS', '無法載入服務帳戶憑證，請檢查 GOOGLE_APPLICATION_CREDENTIALS 設定。');
}

async function createAssertion(filename, now) {
  try {
    if (!filename) throw credentialError();
    const [file, root] = await Promise.all([realpath(filename), realpath(PROJECT_ROOT)]);
    const relative = path.relative(root, file);
    if (relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
      throw credentialError();
    }
    const credentials = JSON.parse(await readFile(file, 'utf8'));
    const { type, client_email: email, private_key: key } = credentials;
    if (type !== 'service_account' || typeof email !== 'string' || !email || typeof key !== 'string') {
      throw credentialError();
    }
    const encode = (json) => Buffer.from(JSON.stringify(json)).toString('base64url');
    const header = encode({ alg: 'RS256', typ: 'JWT' });
    const claims = encode({ iss: email, aud: TOKEN_URL, scope: SCOPE, iat: now, exp: now + 3600 });
    const unsigned = `${header}.${claims}`;
    const signature = sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url');
    return `${unsigned}.${signature}`;
  } catch {
    throw credentialError();
  }
}

function upstreamError(status, payload, authenticating) {
  const limitReasons = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded']);
  const errors = payload?.error?.errors;
  if (status === 429 || payload?.error?.status === 'RESOURCE_EXHAUSTED' ||
      (Array.isArray(errors) && errors.some((error) => limitReasons.has(error?.reason)))) {
    return new AppError(429, 'SHEETS_QUOTA', 'Google Sheets API 配額或呼叫頻率已達上限，請稍後再試。');
  }
  if (status === 408 || status === 504) {
    return new AppError(504, 'SHEETS_TIMEOUT', '連線 Google 逾時，請稍後再試。');
  }
  if (authenticating && status < 500) {
    return new AppError(502, 'SHEETS_AUTH', 'Google 拒絕服務帳戶驗證，請確認金鑰有效。');
  }
  if (status === 401 || status === 403) {
    return new AppError(403, 'SHEETS_PERMISSION', '服務帳戶無法存取試算表，請確認已共用編輯權限並啟用 Sheets API。');
  }
  if (status === 404) {
    return new AppError(404, 'SHEETS_NOT_FOUND', 'Google 找不到試算表，請確認網址或 ID 正確且服務帳戶有權存取。');
  }
  return new AppError(502, 'SHEETS_API', 'Google Sheets API 無法完成要求，請稍後再試。');
}

function invalidResponse() {
  return new AppError(502, 'SHEETS_BAD_RESPONSE', 'Google 回傳的試算表資料格式無效。');
}

function gridSheets(payload) {
  if (!Array.isArray(payload.sheets)) throw invalidResponse();
  return payload.sheets.filter(({ properties }) => properties?.sheetType === 'GRID');
}

export function createSheetsGateway({ credentialsFile, clock = systemClock, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  let cachedToken;
  let pendingToken;

  async function requestJson(url, options, { authenticating = false } = {}) {
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    let payload;
    try {
      response = await fetchImpl(url, { ...options, redirect: 'error', signal });
      payload = await response.json().catch((error) => {
        if (error instanceof SyntaxError) return null;
        throw error;
      });
    } catch (error) {
      if (signal.aborted || error?.name === 'TimeoutError') {
        throw new AppError(504, 'SHEETS_TIMEOUT', '連線 Google 逾時，請稍後再試。');
      }
      throw new AppError(502, 'SHEETS_NETWORK', '無法連線 Google，請檢查網路後再試。');
    }
    if (!response.ok) throw upstreamError(response.status, payload, authenticating);
    if (!payload || typeof payload !== 'object') throw invalidResponse();
    return payload;
  }

  async function refreshToken(now) {
    const assertion = await createAssertion(credentialsFile, now);
    const json = await requestJson(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    }, { authenticating: true });
    if (typeof json.access_token !== 'string' || !json.access_token || !Number.isFinite(json.expires_in) ||
        json.expires_in <= 0 || /\s/.test(json.access_token)) throw invalidResponse();
    cachedToken = { value: json.access_token, expiresAt: now + json.expires_in };
    return cachedToken.value;
  }

  function getToken() {
    const now = Math.floor(clock.now().getTime() / 1000);
    if (cachedToken?.expiresAt > now + 30) return cachedToken.value;
    pendingToken ??= refreshToken(now).finally(() => { pendingToken = null; });
    return pendingToken;
  }

  // Keep the authenticated transport here so SF-04 can add RAW write or a narrower re-read.
  async function requestSheet(spreadsheetId, fields, { action = '', body } = {}) {
    const id = parseSpreadsheetId(spreadsheetId);
    const url = new URL(`${SHEETS_URI}${id}${action}`);
    url.searchParams.set('fields', fields);
    const headers = { Authorization: `Bearer ${await getToken()}` };
    if (body === undefined) return requestJson(url, { headers });
    return requestJson(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  return {
    async listSheets(spreadsheetId) {
      const data = await requestSheet(spreadsheetId, LIST_FIELDS);
      return gridSheets(data).map(({ properties }) => ({ id: properties.sheetId, title: properties.title }));
    },
    async readSheets(spreadsheetId, sheetIds) {
      const data = await requestSheet(spreadsheetId, GRID_FIELDS, {
        action: ':getByDataFilter',
        body: { dataFilters: sheetIds.map((sheetId) => ({ gridRange: { sheetId } })) },
      });
      const byId = new Map(gridSheets(data).map((sheet) => [sheet.properties.sheetId, sheet]));
      return sheetIds.map((id) => {
        const sheet = byId.get(id);
        if (!sheet) {
          throw badRequest('SHEETS_SHEET_UNAVAILABLE', '選擇的工作表目前無法匯入，請重新載入工作表清單。');
        }
        return { id, title: sheet.properties.title, gridProperties: sheet.properties.gridProperties ?? null,
          data: sheet.data ?? [], merges: sheet.merges ?? [] };
      });
    },

    /**
     * SF-04: re-reads the current structure and value of each target cell, identified by sheet ID.
     * Cells on deleted sheets or outside the current grid are not requested (`value: null`), so a
     * structural change never fails the whole read. Returns one `{ sheet, value }` per target.
     */
    async readTargets(spreadsheetId, targets) {
      const structure = await requestSheet(spreadsheetId, STRUCTURE_FIELDS);
      const sheets = new Map(gridSheets(structure).map(({ properties, merges }) => [properties.sheetId, {
        id: properties.sheetId, title: properties.title, rowCount: properties.gridProperties?.rowCount ?? 0,
        columnCount: properties.gridProperties?.columnCount ?? 0, merges: merges ?? [],
      }]));
      const readable = targets.filter(({ sheetId, rowIndex, columnIndex }) => {
        const sheet = sheets.get(sheetId);
        return sheet && rowIndex < sheet.rowCount && columnIndex < sheet.columnCount;
      });
      const values = new Map();
      if (readable.length) {
        const data = await requestSheet(spreadsheetId, CELL_FIELDS, {
          action: ':getByDataFilter',
          body: { dataFilters: readable.map((target) => ({ gridRange: cellRange(target) })) },
        });
        if (!Array.isArray(data.sheets)) throw invalidResponse();
        for (const { properties, data: grids = [] } of data.sheets) {
          for (const { startRow = 0, startColumn = 0, rowData = [] } of grids) {
            rowData.forEach((row, rowOffset) => row?.values?.forEach((cell, columnOffset) => {
              values.set(cellKey(properties?.sheetId, startRow + rowOffset, startColumn + columnOffset), cell?.userEnteredValue);
            }));
          }
        }
      }
      return targets.map(({ sheetId, rowIndex, columnIndex }) => ({
        sheet: sheets.get(sheetId) ?? null,
        value: values.get(cellKey(sheetId, rowIndex, columnIndex)) ?? null,
      }));
    },

    /**
     * SF-04: writes every cell in one spreadsheets.batchUpdate, which Google applies atomically.
     * `userEnteredValue.stringValue` is stored as literal text, like the values API's RAW
     * option, so "=1+1" never becomes a formula; `fields` limits the change to the value.
     */
    async writeCells(spreadsheetId, cells) {
      await requestSheet(spreadsheetId, 'spreadsheetId', {
        action: ':batchUpdate',
        body: { requests: cells.map((cell) => ({ updateCells: {
          range: cellRange(cell),
          rows: [{ values: [{ userEnteredValue: { stringValue: cell.text } }] }],
          fields: 'userEnteredValue',
        } })) },
      });
    },
  };
}
