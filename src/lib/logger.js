/**
 * Minimal logger with secret redaction (spec.md §7: logs must not leak secrets).
 * Any metadata key that looks like a secret is replaced with "[REDACTED]".
 */

const SENSITIVE_KEY = /pass(word)?|secret|token|cookie|authorization|credential|private[_-]?key|session/i;
const MAX_DEPTH = 5;
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function redact(value, depth = 0) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[Truncated]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(item, depth + 1);
  }
  return result;
}

/**
 * @param {{ level?: keyof LEVELS, sink?: { log: Function, error: Function } }} [options]
 */
export function createLogger({ level = process.env.LOG_LEVEL ?? 'info', sink = console } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(name, message, meta) {
    if (LEVELS[name] < threshold) return;
    const line = `${new Date().toISOString()} ${name.toUpperCase()} ${message}`;
    const output = meta === undefined ? line : `${line} ${JSON.stringify(redact(meta))}`;
    (name === 'error' || name === 'warn' ? sink.error : sink.log).call(sink, output);
  }

  return Object.freeze({
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  });
}

/** Logger that discards everything; handy in tests. */
export const silentLogger = createLogger({ level: 'silent' });
