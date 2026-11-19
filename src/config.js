import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (one level above src/). */
export const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** spec.md §7: the service binds to localhost only. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Reads runtime configuration from environment variables.
 *
 * | Variable                       | Default                 |
 * | ------------------------------ | ----------------------- |
 * | HOST                           | 127.0.0.1 (loopback only) |
 * | PORT                           | 3000                    |
 * | DATA_DIR                       | <repo>/data             |
 * | DATABASE_FILE                  | <DATA_DIR>/buzzer.sqlite |
 * | GOOGLE_APPLICATION_CREDENTIALS | unset (must be outside the repository) |
 *
 * @param {Record<string, string | undefined>} env
 */
export function loadConfig(env = process.env) {
  const host = readString(env.HOST) ?? '127.0.0.1';
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new ConfigError(
      `HOST 只能是 localhost（127.0.0.1、::1 或 localhost），目前為「${host}」。`,
    );
  }

  const port = parsePort(readString(env.PORT) ?? '3000');
  const dataDir = path.resolve(PROJECT_ROOT, readString(env.DATA_DIR) ?? 'data');
  const databaseFileSetting = readString(env.DATABASE_FILE);
  const databaseFile =
    databaseFileSetting === ':memory:'
      ? ':memory:'
      : databaseFileSetting
        ? path.resolve(PROJECT_ROOT, databaseFileSetting)
        : path.join(dataDir, 'buzzer.sqlite');

  return Object.freeze({
    host,
    port,
    dataDir,
    databaseFile,
    googleCredentialsFile: resolveCredentialsPath(env.GOOGLE_APPLICATION_CREDENTIALS),
  });
}

function readString(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`PORT 必須是 0～65535 的整數，目前為「${value}」。`);
  }
  return port;
}

/**
 * spec.md §7: credentials live outside the repository and are referenced by an
 * environment variable. Only the path is handled here; the file is read by the backend
 * feature that needs it, never logged or returned.
 */
function resolveCredentialsPath(value) {
  const setting = readString(value);
  if (!setting) return null;

  const resolved = path.resolve(setting);
  if (isInside(PROJECT_ROOT, resolved)) {
    throw new ConfigError(
      'GOOGLE_APPLICATION_CREDENTIALS 指向 repository 內的檔案；請把服務帳戶金鑰移到 repository 之外。',
    );
  }
  return resolved;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
