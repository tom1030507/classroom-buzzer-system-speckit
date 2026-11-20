import { phaseLabel, phaseWentBack, watchActivity } from '/js/activity-events.js';
import { apiFetch } from '/js/api.js';
import { h, setText } from '/js/dom.js';

const panel = document.querySelector('#student-buzzer');
const phase = h('p', { role: 'status' });
const connection = h('p', { class: 'status', role: 'status' });
const feedback = h('p', { class: 'status status--error', role: 'alert', hidden: true });
const empty = h('p', { hidden: true }, '等待老師匯入題目。');
const units = h('div');
let current;

panel.setAttribute('aria-labelledby', 'student-buzzer-heading');
panel.append(h('h2', { id: 'student-buzzer-heading' }, '作答'), phase, connection, feedback, empty, units);

function showError(message) {
  setText(feedback, message);
  feedback.hidden = !message;
}

function reflectPhase(state) {
  const { status, mode } = state.activity;
  const label = `${phaseLabel[status]}・${mode === 'FAIR' ? '公平模式' : '速度模式'}`;
  if (phase.textContent !== label) setText(phase, label);
}

function refreshForm(state, view) {
  const canAnswer = state.activity.status === 'OPEN' && !view.receipt;
  view.form.hidden = !canAnswer;
  view.button.disabled = view.pending;
  setText(view.button, view.pending ? '送出中…' : view.submitLabel);
}

function showReceipt(state, view, receipt) {
  if (view.receipt) return;
  const returnFocus = view.form.contains(document.activeElement);
  view.receipt = receipt;
  setText(view.feedback, '');
  view.receiptPanel.hidden = false;
  view.receiptPanel.replaceChildren(
    h('p', { class: 'status status--success', role: 'status' }, '已受理'),
    h('p', { class: 'answer-text' }, `受理識別 ${receipt.id}`),
    h('dl', null, ...receipt.answers.flatMap(({ questionKey, text }) => [
      h('dt', null, `第 ${questionKey} 題`), h('dd', { class: 'answer-text' }, text),
    ])),
  );
  refreshForm(state, view);
  if (returnFocus) view.receiptPanel.focus();
}

async function submit(state, view) {
  if (state !== current || state.activity.status !== 'OPEN' || view.receipt || view.pending) return;
  const { unitId } = view;
  const answers = view.fields.map(({ questionKey, field }) => ({ questionKey, text: field.value }));
  view.pending = true;
  setText(view.feedback, '');
  refreshForm(state, view);
  try {
    const reply = await apiFetch(`/api/student/units/${encodeURIComponent(unitId)}/submissions`, {
      method: 'POST', body: { answers },
      signal: AbortSignal.any([state.controller.signal, AbortSignal.timeout(10_000)]),
    });
    if (state !== current || state.views.get(unitId) !== view) return;
    if (!reply?.receipt?.id || reply.receipt.unitId !== unitId || !Array.isArray(reply.receipt.answers)) {
      throw new Error('未收到受理回覆。請重新送出或確認作答紀錄。');
    }
    showReceipt(state, view, reply.receipt);
  } catch (error) {
    if (state === current && state.views.get(unitId) === view && !view.receipt) {
      setText(view.feedback, error.code === 'NETWORK_ERROR'
        ? '未收到受理回覆。請確認連線後重試或查看作答紀錄。'
        : error.message);
    }
  } finally {
    view.pending = false;
    refreshForm(state, view);
  }
}

function createUnit(state, unit, shape) {
  const isGroup = unit.kind === 'GROUP';
  const title = unit.questions.map(({ key }) => `第 ${key} 題`).join('、');
  const heading = h('h3', { id: `buzzer-unit-${unit.id}` }, isGroup ? `題組（${title}）` : title);
  const fields = unit.questions.map(({ key }, index) => ({
    questionKey: key,
    field: h('textarea', { id: `buzzer-answer-${unit.id}-${index}`, rows: '3', required: true }),
  }));
  const submitLabel = isGroup ? '送出整個題組' : '送出答案';
  const button = h('button', { type: 'submit' }, submitLabel);
  const unitFeedback = h('p', { role: 'alert' });
  const form = h('form', { hidden: true, 'aria-labelledby': heading.id },
    ...fields.map(({ questionKey, field }) => h('div', null,
      h('label', { for: field.id }, `第 ${questionKey} 題`), field,
    )), button,
  );
  const receiptPanel = h('div', { tabindex: '-1', hidden: true });
  const node = h('section', { 'aria-labelledby': heading.id }, heading, form, unitFeedback, receiptPanel);
  const view = { unitId: unit.id, shape, node, form, button, submitLabel, fields, receiptPanel, feedback: unitFeedback };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(state, view);
  });
  return view;
}

function updateSnapshot(state, snapshot) {
  if (snapshot?.activity?.id !== state.activity.id || phaseWentBack(state.activity.status, snapshot.activity.status)) return;
  // A mode change while preparing is announced like a phase change, as the teacher page already does (SF-05).
  const phaseChanged = state.activity.status !== snapshot.activity.status || state.activity.mode !== snapshot.activity.mode;
  state.activity = snapshot.activity;
  if (phaseChanged) {
    document.dispatchEvent(new CustomEvent('student-activity-phase', { detail: state.activity }));
  }
  reflectPhase(state);
  showError('');
  empty.hidden = snapshot.units.length > 0 || state.activity.status !== 'PREPARING';
  const shown = new Set();
  snapshot.units.forEach((unit, index) => {
    shown.add(unit.id);
    const shape = JSON.stringify([unit.kind, unit.questions.map(({ key }) => key)]);
    let view = state.views.get(unit.id);
    if (!view || view.shape !== shape) {
      view?.node.remove();
      view = createUnit(state, unit, shape);
      state.views.set(unit.id, view);
    }
    if (units.children[index] !== view.node) units.insertBefore(view.node, units.children[index] ?? null);
    if (unit.receipt) showReceipt(state, view, unit.receipt);
    refreshForm(state, view);
  });
  for (const [id, view] of state.views) {
    if (shown.has(id)) continue;
    view.node.remove();
    state.views.delete(id);
  }
  if (state.activity.status === 'CLOSED' && !state.announcedClose) {
    state.announcedClose = true;
    document.dispatchEvent(new CustomEvent('student-activity-closed', { detail: state.activity }));
  }
}

document.addEventListener('student-activity', ({ detail: activity }) => {
  if (current && current.activity.id === activity?.id) return;
  current?.controller.abort();
  current = null;
  panel.hidden = !activity;
  units.replaceChildren();
  empty.hidden = true;
  if (!activity) return;
  const state = { activity, views: new Map(), controller: new AbortController() };
  current = state;
  reflectPhase(state);
  showError('');
  watchActivity({
    snapshotUrl: '/api/student/activity', eventsUrl: '/api/student/events', signal: state.controller.signal,
    onSnapshot: (snapshot) => updateSnapshot(state, snapshot),
    onConnection: (message) => setText(connection, message), onError: showError,
  });
});
