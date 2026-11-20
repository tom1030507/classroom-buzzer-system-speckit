const SNAPSHOT_INTERVAL_MS = 250;
const HEARTBEAT_INTERVAL_MS = 15_000;

/** A stream observes only the caller's snapshot. Equal projections never emit an event. */
export function streamSnapshots(res, snapshot) {
  let current = JSON.stringify(snapshot());
  let lastWrite = performance.now();
  res.set('Content-Type', 'text/event-stream; charset=utf-8');
  res.flushHeaders();
  res.write(`event: snapshot\ndata: ${current}\n\n`);

  const timer = setInterval(() => {
    try {
      const next = JSON.stringify(snapshot());
      if (res.writableNeedDrain) return;
      if (next !== current) {
        current = next;
        res.write(`event: snapshot\ndata: ${current}\n\n`);
        lastWrite = performance.now();
      } else if (performance.now() - lastWrite >= HEARTBEAT_INTERVAL_MS) {
        res.write(': keep-alive\n\n');
        lastWrite = performance.now();
      }
    } catch {
      // Session revoked, server shutting down, or a temporary database error.
      // End the stream so EventSource reconnects and revalidates the session.
      clearInterval(timer);
      res.end();
    }
  }, SNAPSHOT_INTERVAL_MS);
  timer.unref();
  res.on('close', () => clearInterval(timer));
}
