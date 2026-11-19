/**
 * Baseline security headers (constitution principle II, spec.md §7 and AC-16).
 * The CSP forbids inline scripts, so user content can never execute even if it is
 * accidentally inserted as HTML. Session cookies, Origin and CSRF checks belong to SF-01.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const HEADERS = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
});

export function securityHeaders() {
  return function setSecurityHeaders(req, res, next) {
    res.set(HEADERS);
    next();
  };
}

/** API responses carry per-session data and must never be cached. */
export function noStore() {
  return function setNoStore(req, res, next) {
    res.set('Cache-Control', 'no-store');
    next();
  };
}
