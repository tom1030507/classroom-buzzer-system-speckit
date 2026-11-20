import { apiFetch } from '/js/api.js';
import { h, setText } from '/js/dom.js';
import { modeLabel, renderResults } from '/js/results-view.js';

const panel = document.querySelector('#student-results');
const heading = h('h2', { id: 'student-results-heading' }, '各組結果');
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
    // The server returns results only for this group's own activity, and only after it closed.
    const view = await apiFetch('/api/student/results', { signal: state.controller.signal });
    if (current !== state || view.activity.id !== state.id) return;
    state.loaded = true;
    setText(summary, `活動已結束・${modeLabel[view.activity.mode] ?? view.activity.mode}。`);
    results.replaceChildren(...renderResults(view, { idPrefix: 'student-results-unit' }));
  } catch (error) {
    if (current !== state) return;
    setText(summary, '');
    showError(error.message);
  } finally {
    state.loading = false;
  }
}

retry.addEventListener('click', () => {
  if (current && !current.loading) void load(current);
});

document.addEventListener('student-activity', ({ detail: activity }) => {
  if (activity && current?.id === activity.id) return;
  current?.controller.abort();
  current = activity ? { id: activity.id, loaded: false, loading: false, controller: new AbortController() } : null;
  panel.hidden = true;
  results.replaceChildren();
  setText(summary, '');
  showError('');
});

// SF-03 announces the close from the live snapshot, including when the page opens after closing.
document.addEventListener('student-activity-closed', ({ detail: activity }) => {
  if (!current || activity?.id !== current.id || current.loaded || current.loading) return;
  void load(current);
});
