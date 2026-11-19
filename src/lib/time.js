/**
 * Server clock. All timestamps are stored as UTC ISO 8601 strings (spec.md FR-09).
 * Inject a different clock in tests instead of mocking Date globally.
 */
export const systemClock = Object.freeze({
  now: () => new Date(),
});

/** @param {{ now: () => Date }} [clock] */
export function nowIso(clock = systemClock) {
  return clock.now().toISOString();
}

/** Clock that returns a fixed instant and can be advanced manually (tests only). */
export function createFixedClock(isoString = '2026-01-01T00:00:00.000Z') {
  let current = new Date(isoString);
  return {
    now: () => new Date(current),
    advance(milliseconds) {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}
