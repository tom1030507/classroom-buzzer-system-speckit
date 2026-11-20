/**
 * SF-05 mode selection (FR-007, FR-008, FR-011). The teacher picks speed or fair mode while the
 * activity is preparing; once it is open the mode is locked and shown read-only. The server decides
 * (POST …/mode answers 409 after opening), so this page only reflects what it is told.
 */
import { apiFetch } from '/js/api.js';
import { h, setText } from '/js/dom.js';
import { modeLabel, renderModeRule } from '/js/mode-rules.js';

const panel = document.querySelector('#mode-select');
const radios = new Map(['SPEED', 'FAIR'].map((mode) => [
  mode, h('input', { type: 'radio', name: 'activity-mode', id: `activity-mode-${mode.toLowerCase()}`, value: mode }),
]));
const choices = [...radios].map(([mode, radio]) => h('div', { class: 'actions' },
  radio, h('label', { for: radio.id }, modeLabel[mode])));
const group = h('fieldset', null, h('legend', null, '活動模式'), ...choices);
const rule = h('div');
const lockNote = h('p');
const progress = h('p', { class: 'status', role: 'status', hidden: true });
const failure = h('p', { class: 'status status--error', role: 'alert', hidden: true });
let current;

panel.setAttribute('aria-label', '活動模式');
panel.append(group, rule, lockNote, progress, failure);

function showProgress(message) {
  setText(progress, message);
  progress.hidden = !message;
}

function showFailure(message) {
  setText(failure, message);
  failure.hidden = !message;
}

function render() {
  if (!current) {
    panel.hidden = true;
    return;
  }
  const editable = current.status === 'PREPARING';
  // Once closed, the result page shows the mode and its rule instead.
  panel.hidden = current.status === 'CLOSED';
  for (const [mode, radio] of radios) {
    radio.checked = mode === current.mode;
    radio.disabled = !editable || current.pending;
  }
  rule.replaceChildren(renderModeRule(current.mode));
  setText(lockNote, editable ? '開啟活動後，模式就會鎖定，無法更改。' : '活動已開啟，模式已鎖定。');
}

function update(activity) {
  // A confirmation such as 「已改為公平模式。」 is about the earlier change; drop it once the activity moves on.
  if (current.status && current.status !== activity.status) showProgress('');
  current.mode = activity.mode;
  current.status = activity.status;
  render();
}

async function choose(state, mode) {
  state.pending = true;
  showFailure('');
  showProgress('正在更新模式…');
  render();
  try {
    const { activity } = await apiFetch(`/api/teacher/activities/${encodeURIComponent(state.id)}/mode`, {
      method: 'POST', body: { mode },
    });
    if (current !== state) return;
    update(activity);
    showProgress(`已改為${modeLabel[activity.mode]}。`);
  } catch (error) {
    if (current !== state) return;
    showProgress('');
    showFailure(error.message);
  } finally {
    if (current === state) {
      state.pending = false;
      render();
    }
  }
}

group.addEventListener('change', ({ target }) => {
  if (!current || current.pending || current.status !== 'PREPARING' || target.value === current.mode) return;
  void choose(current, target.value);
});

// The full activity (SF-01) establishes which activity this panel is about.
document.addEventListener('teacher-activity', ({ detail: activity }) => {
  if (!activity) {
    current = null;
    showProgress('');
    showFailure('');
    render();
    return;
  }
  if (current?.id !== activity.id) {
    current = { id: activity.id, pending: false };
    showProgress('');
    showFailure('');
  }
  update(activity);
});

// SF-03 announces status and mode changes from its live snapshot, so a change made in another tab appears here.
document.addEventListener('teacher-activity-phase', ({ detail: activity }) => {
  if (current && activity?.id === current.id) update(activity);
});
