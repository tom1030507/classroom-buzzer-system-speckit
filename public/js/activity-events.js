import { apiFetch } from '/js/api.js';

export const phaseLabel = Object.freeze({ PREPARING: '準備中', OPEN: '搶答中', CLOSED: '已結束' });
const phaseOrder = Object.keys(phaseLabel);

export function phaseWentBack(previous, current) {
  return phaseOrder.indexOf(current) < phaseOrder.indexOf(previous);
}

export function watchActivity({ snapshotUrl, eventsUrl, signal, onSnapshot, onConnection, onError }) {
  const source = new EventSource(eventsUrl);
  let receivedLiveSnapshot = false;
  let lastConnectionMessage;

  function showConnection(message) {
    if (signal.aborted || message === lastConnectionMessage) return;
    lastConnectionMessage = message;
    onConnection(message);
  }

  showConnection('正在建立即時連線…');
  signal.addEventListener('abort', () => source.close(), { once: true });
  source.addEventListener('open', () => showConnection('即時連線已連接。'));
  source.addEventListener('error', () => {
    showConnection(source.readyState === EventSource.CLOSED
      ? '即時連線中斷。請重新整理頁面。'
      : '即時連線中斷，正在重新連線…');
  });
  source.addEventListener('snapshot', (event) => {
    if (signal.aborted) return;
    let snapshot;
    try {
      snapshot = JSON.parse(event.data);
    } catch {
      onError('無法讀取即時資料。請重新整理頁面。');
      return;
    }
    receivedLiveSnapshot = true;
    showConnection('即時連線已連接。');
    onSnapshot(snapshot);
  });

  // A later HTTP response can be older than a snapshot already received over SSE.
  apiFetch(snapshotUrl, { signal }).then((snapshot) => {
    if (!signal.aborted && !receivedLiveSnapshot) onSnapshot(snapshot);
  }).catch((error) => {
    if (!signal.aborted && !receivedLiveSnapshot) onError(error.message);
  });
}
