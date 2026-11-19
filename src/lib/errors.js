/**
 * Application error with an HTTP status and a stable machine-readable code.
 * Every API error response has the shape { "error": { "code", "message" } }
 * (constitution: 技術約束與專案結構). Messages are shown to users, so they must never
 * contain secrets or other groups' data (spec.md FR-05).
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code   stable error code, e.g. "INVALID_PHASE"
   * @param {string} message user-facing message
   * @param {{ details?: Record<string, unknown>, cause?: unknown }} [options]
   */
  constructor(status, code, message, { details, cause } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toResponseBody() {
    const error = { code: this.code, message: this.message };
    if (this.details !== undefined) error.details = this.details;
    return { error };
  }
}

export const badRequest = (code, message, options) => new AppError(400, code, message, options);
export const unauthorized = (code, message, options) => new AppError(401, code, message, options);
export const forbidden = (code, message, options) => new AppError(403, code, message, options);
export const notFound = (code, message, options) => new AppError(404, code, message, options);
export const conflict = (code, message, options) => new AppError(409, code, message, options);
