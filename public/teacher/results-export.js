import { apiFetch } from '/js/api.js';
import { h, setText } from '/js/dom.js';
import { modeLabel, renderResults } from '/js/results-view.js';

const panel = document.querySelector('#results-export');
const heading = h('h2', { id: 'results-export-heading' }, '結果與匯出');
const summary = h('p', { role: 'status' });
const feedback = h('p', { class: 'status status--error', role: 'alert', hidden: true });
const retry = h('button', { type: 'button', hidden: true }, '重新載入結果');
const results = h('div');

// ── Write-back to the original Google spreadsheet (FR-07) ───────────────────────
const previewButton = h('button', { type: 'button' }, '預覽寫回');
const exportProgress = h('p', { class: 'status', role: 'status', hidden: true });
const exportError = h('p', { class: 'status status--error', role: 'alert', hidden: true });
const previewSummary = h('p', { hidden: true });
const conflictWarning = h('p', { class: 'status status--warning', role: 'alert', hidden: true },
  '有題目衝突，這次無法寫回，也不會寫入任何格子。請把試算表恢復成匯入時的結構與標記後重新預覽，或另建活動重新匯入。');
const previewTable = h('div');
const paused = h('input', { type: 'checkbox', id: 'sheets-export-paused' });
const writeButton = h('button', { type: 'button', disabled: true }, '寫回試算表');
const confirmArea = h('div', { hidden: true },
  h('div', { class: 'actions' }, paused, h('label', { for: 'sheets-export-paused' }, '我已請其他人暫停編輯這份試算表')),
  h('div', { class: 'actions' }, writeButton),
);
const recordSummary = h('p', { class: 'status', hidden: true });
const recordCounts = h('p', { hidden: true });
const recordTable = h('div');
const resumeReminder = h('p', { hidden: true }, '寫回已結束，請通知其他人恢復編輯這份試算表。');
const exportSection = h('section', { 'aria-labelledby': 'sheets-export-heading', hidden: true },
  h('h3', { id: 'sheets-export-heading' }, '寫回原 Google 試算表'),
  h('p', null, '先預覽要寫回的題號、勝出組、答案與目標格。寫回只修改勝出答案的原答案格，以純文字寫入；無人作答的格子不變。'),
  h('div', { class: 'actions' }, previewButton),
  exportProgress, exportError, previewSummary, conflictWarning, previewTable, confirmArea,
  recordSummary, recordCounts, recordTable, resumeReminder,
);

// ── CSV download (FR-09) ─────────────────────────────────────────────────────────
const csvLink = h('a', { download: '' }, '下載 CSV');
const csvSection = h('p', { hidden: true }, csvLink, '（UTF-8，含所有組的受理答案與無人作答的題目）');

let current;

/** "公平模式・" in front of the write-back texts, so the mode is stated next to the winners it writes (FR-013). */
const modeNote = (state) => (state?.mode ? `${modeLabel[state.mode] ?? state.mode}・` : '');

panel.setAttribute('aria-labelledby', heading.id);
panel.append(heading, summary, feedback, h('div', { class: 'actions' }, retry), csvSection, results, exportSection);

const previewLabel = Object.freeze({
  READY: '可寫入', ALREADY_PRESENT: '已是相同內容', CONFLICT: '衝突', NO_ANSWER: '無人作答，不寫入',
});
const recordLabel = Object.freeze({
  WRITTEN: '成功', ALREADY_PRESENT: '已是相同內容', CONFLICT: '衝突', SKIPPED: '未寫入（整批停止）',
  FAILED: '失敗', UNKNOWN: '待核對', PENDING: '寫入中',
});

function showError(message) {
  setText(feedback, message);
  feedback.hidden = !message;
  retry.hidden = !message;
}

function showExportError(message) {
  setText(exportError, message);
  exportError.hidden = !message;
}

function showProgress(message) {
  setText(exportProgress, message);
  exportProgress.hidden = !message;
}

function itemTable(items, label, caption) {
  const status = (item) => (item.reasonText ? `${label[item.status]}：${item.reasonText}` : label[item.status]);
  return h('div', { class: 'results-scroll', role: 'region', tabindex: '0', 'aria-label': caption },
    h('table', { class: 'results-table' },
      h('caption', { class: 'visually-hidden' }, caption),
      h('thead', null, h('tr', null, ...['題號', '勝出組', '答案', '目標格', '狀態'].map((text) => h('th', { scope: 'col' }, text)))),
      h('tbody', null, ...items.map((item) => h('tr', null,
        h('th', { scope: 'row' }, `第 ${item.questionKey} 題`),
        h('td', null, item.groupName ?? '—'),
        h('td', { class: 'answer-text' }, item.content ?? '—'),
        h('td', null, `「${item.target.sheetTitle}」${item.target.cell}`),
        h('td', null, status(item)),
      ))),
    ),
  );
}

function refreshExportControls(state) {
  const preview = state.preview;
  const writable = preview && preview.counts.CONFLICT === 0 && preview.counts.READY + preview.counts.ALREADY_PRESENT > 0;
  confirmArea.hidden = !writable;
  writeButton.disabled = state.busy || !writable || !paused.checked;
  previewButton.disabled = state.busy;
}

function renderPreview(state, preview) {
  state.preview = preview;
  const { READY, ALREADY_PRESENT, CONFLICT, NO_ANSWER } = preview.counts;
  setText(previewSummary, `${modeNote(state)}共 ${preview.items.length} 題：可寫入 ${READY}、已是相同內容 ${ALREADY_PRESENT}、衝突 ${CONFLICT}、無人作答 ${NO_ANSWER}。`
    + (READY + ALREADY_PRESENT + CONFLICT === 0 ? '沒有需要寫回的勝出答案。' : ''));
  previewSummary.hidden = false;
  conflictWarning.hidden = CONFLICT === 0;
  previewTable.replaceChildren(itemTable(preview.items, previewLabel, '寫回預覽'));
  paused.checked = false;
  refreshExportControls(state);
}

const outcomeText = Object.freeze({
  SUCCEEDED: ['寫回完成：所有勝出答案都已在原答案格核對無誤。', 'status--success'],
  CONFLICT: ['寫回未完成：有題目衝突，請依下表處理後重新預覽。', 'status--warning'],
  FAILED: ['寫回失敗，沒有回報成功的題目請依下表處理後重試。', 'status--error'],
  UNKNOWN: ['寫回結果待核對：無法確定部分答案是否已寫入。請重新預覽並寫回，系統會先核對線上內容，不會重複或覆寫。', 'status--warning'],
  RUNNING: ['另一個分頁正在寫回，請稍後重新整理查看結果。', 'status--warning'],
});

function renderRecord(record) {
  if (!record) {
    recordSummary.hidden = true;
    recordCounts.hidden = true;
    resumeReminder.hidden = true;
    recordTable.replaceChildren();
    return;
  }
  const [text, tone] = outcomeText[record.outcome];
  const time = record.finishedAt ? `（${new Date(record.finishedAt).toLocaleString('zh-TW', { hourCycle: 'h23' })}）` : '';
  recordSummary.className = `status ${tone}`;
  setText(recordSummary, `${modeNote(current)}最近一次寫回${time}：${text}${record.error ? `原因：${record.error.message}` : ''}`);
  recordSummary.hidden = false;
  const counts = Object.entries(record.counts).filter(([, count]) => count > 0)
    .map(([status, count]) => `${recordLabel[status]} ${count}`).join('、');
  setText(recordCounts, counts ? `逐題結果：${counts}。` : '');
  recordCounts.hidden = !counts;
  recordTable.replaceChildren(...(record.items.length ? [itemTable(record.items, recordLabel, '最近一次寫回的逐題結果')] : []));
  resumeReminder.hidden = record.outcome === 'RUNNING';
}

async function runExportStep(state, step) {
  if (state.busy) return;
  state.busy = true;
  showExportError('');
  refreshExportControls(state);
  try {
    await step();
  } catch (error) {
    if (current === state) showExportError(error.message);
  } finally {
    state.busy = false;
    showProgress('');
    if (current === state) refreshExportControls(state);
  }
}

previewButton.addEventListener('click', () => {
  const state = current;
  if (!state) return;
  void runExportStep(state, async () => {
    showProgress('正在讀取 Google 試算表並核對目標格…');
    const preview = await apiFetch(`${state.baseUrl}/sheets-export/preview`, {
      method: 'POST', body: {}, signal: AbortSignal.any([state.controller.signal, AbortSignal.timeout(60_000)]),
    });
    if (current === state) renderPreview(state, preview);
  });
});

paused.addEventListener('change', () => current && refreshExportControls(current));

writeButton.addEventListener('click', () => {
  const state = current;
  if (!state || writeButton.disabled) return;
  void runExportStep(state, async () => {
    showProgress('正在寫回並回讀核對，請勿關閉頁面…');
    try {
      const { export: record } = await apiFetch(`${state.baseUrl}/sheets-export`, {
        method: 'POST', body: { editsPaused: true },
        signal: AbortSignal.any([state.controller.signal, AbortSignal.timeout(60_000)]),
      });
      if (current !== state) return;
      renderRecord(record);
    } finally {
      // A new write-back always starts from a fresh preview.
      state.preview = null;
      previewSummary.hidden = true;
      conflictWarning.hidden = true;
      previewTable.replaceChildren();
    }
  });
});

async function loadLatestExport(state) {
  try {
    const { export: record } = await apiFetch(`${state.baseUrl}/sheets-export`, { signal: state.controller.signal });
    if (current === state) renderRecord(record);
  } catch (error) {
    if (current === state) showExportError(error.message);
  }
}

async function load(state) {
  state.loading = true;
  panel.hidden = false;
  showError('');
  setText(summary, '正在載入結果…');
  try {
    const view = await apiFetch(`${state.baseUrl}/results`, { signal: state.controller.signal });
    if (current !== state) return;
    state.loaded = true;
    state.mode = view.activity.mode;
    setText(summary, `活動已結束・${modeLabel[view.activity.mode] ?? view.activity.mode}。結果已固定，不能再修改。`);
    results.replaceChildren(...renderResults(view));
    csvLink.href = `${state.baseUrl}/results.csv`;
    csvSection.hidden = false;
    exportSection.hidden = false;
    refreshExportControls(state);
    void loadLatestExport(state);
  } catch (error) {
    if (current !== state) return;
    setText(summary, '');
    showError(error.message);
  } finally {
    state.loading = false;
  }
}

function loadWhenClosed(activity) {
  const state = current;
  if (!state || activity?.id !== state.id || activity.status !== 'CLOSED' || state.loaded || state.loading) return;
  void load(state);
}

retry.addEventListener('click', () => {
  if (current && !current.loading) void load(current);
});

document.addEventListener('teacher-activity', ({ detail: activity }) => {
  if (activity && current?.id === activity.id) {
    loadWhenClosed(activity);
    return;
  }
  current?.controller.abort();
  current = activity ? {
    id: activity.id, loaded: false, loading: false, busy: false, preview: null, controller: new AbortController(),
    baseUrl: `/api/teacher/activities/${encodeURIComponent(activity.id)}`,
  } : null;
  panel.hidden = true;
  results.replaceChildren();
  setText(summary, '');
  showError('');
  csvSection.hidden = true;
  exportSection.hidden = true;
  showExportError('');
  showProgress('');
  previewSummary.hidden = true;
  conflictWarning.hidden = true;
  previewTable.replaceChildren();
  confirmArea.hidden = true;
  paused.checked = false;
  renderRecord(null);
  loadWhenClosed(activity);
});

// SF-03 announces phase changes from its live snapshot, so results appear right after closing.
document.addEventListener('teacher-activity-phase', ({ detail: activity }) => loadWhenClosed(activity));
