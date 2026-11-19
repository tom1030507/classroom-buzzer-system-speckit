/**
 * Thin fetch wrapper for the JSON API. Errors follow { error: { code, message } }.
 * A request only counts as successful when the server answered with 2xx
 * (constitution principle VIII: never show success without the server's acceptance).
 */

const defaultHeaders = new Map();

/** Lets a feature (e.g. SF-01's CSRF token) attach a header to every request. */
export function setDefaultHeader(name, value) {
  if (value === null || value === undefined) defaultHeaders.delete(name);
  else defaultHeaders.set(name, value);
}

export class ApiError extends Error {
  constructor(status, code, message, options) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {string} path e.g. "/api/health"
 * @param {{ method?: string, body?: unknown, signal?: AbortSignal }} [options]
 */
export async function apiFetch(path, { method = 'GET', body, signal } = {}) {
  const headers = new Headers(Object.fromEntries(defaultHeaders));
  headers.set('Accept', 'application/json');
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (cause) {
    throw new ApiError(0, 'NETWORK_ERROR', '無法連線到伺服器，請確認連線後再試一次。', { cause });
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code ?? 'HTTP_ERROR';
    const message = data?.error?.message ?? `伺服器回應錯誤（HTTP ${response.status}）。`;
    throw new ApiError(response.status, code, message);
  }
  return data;
}
