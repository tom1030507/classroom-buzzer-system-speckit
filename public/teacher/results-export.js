import { apiFetch } from '/js/api.js';
import { h, setText } from '/js/dom.js';
import { modeLabel, renderResults } from '/js/results-view.js';

const panel = document.querySelector('#results-export');
const heading = h('h2', { id: 'results-export-heading' }, '結果與匯出');
const summary = h('p', { role: 'status' });
const feedback = h('p', { class: 'status status--error', role: 'alert', hidden: true });
const retry = h('button', { type: 'button', hidden: true }, '重新載入結果');
const results = h('div');
let current;

panel.setAttribute('aria-labelledby', heading.id);
panel.append(heading, summary, feedback, h('div', { class: 'actions' }, retry), results);

function showError(message) {
  setText(feedback, message);
  feedback.hidden = !message;
  retry.hidden = !message;
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
    setText(summary, `活動已結束・${modeLabel[view.activity.mode] ?? view.activity.mode}。結果已固定，不能再修改。`);
    results.replaceChildren(...renderResults(view));
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
    id: activity.id, loaded: false, loading: false, controller: new AbortController(),
    baseUrl: `/api/teacher/activities/${encodeURIComponent(activity.id)}`,
  } : null;
  panel.hidden = true;
  results.replaceChildren();
  setText(summary, '');
  showError('');
  loadWhenClosed(activity);
});

// SF-03 announces phase changes from its live snapshot, so results appear right after closing.
document.addEventListener('teacher-activity-phase', ({ detail: activity }) => loadWhenClosed(activity));
