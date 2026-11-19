import { AppError, notFound } from '../lib/errors.js';

/** Unknown /api routes answer with JSON instead of falling through to static files. */
export function apiNotFound() {
  return function handleApiNotFound(req, res, next) {
    next(notFound('NOT_FOUND', '找不到這個 API。'));
  };
}

/**
 * Central error handler. Known errors keep their status and code; anything else becomes a
 * generic 500 so stack traces and internal details never reach the client (spec.md §7).
 */
export function errorHandler({ logger }) {
  // Express recognises error handlers by their four parameters, so `next` must stay.
  return function handleError(err, req, res, next) {
    if (res.headersSent) {
      logger.error('Error after response started', { method: req.method, path: req.path, error: err });
      res.end();
      return;
    }

    if (err instanceof AppError) {
      res.status(err.status).json(err.toResponseBody());
      return;
    }

    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: '請求內容不是有效的 JSON。' } });
      return;
    }

    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: '請求內容過大。' } });
      return;
    }

    logger.error('Unhandled error', { method: req.method, path: req.path, error: err });
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: '伺服器發生錯誤，請稍後再試。' } });
  };
}
