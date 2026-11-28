import { phaseLabel, phaseWentBack, watchActivity } from '/js/activity-events.js';
import { apiFetch } from '/js/api.js';
import { h, setText } from '/js/dom.js';

const panel = document.querySelector('#teacher-buzzer');
const phase = h('p', { role: 'status' });
const connection = h('p', { class: 'status', role: 'status' });
const feedback = h('p', { class: 'status status--error', role: 'alert', hidden: true });
const open = h('button', { type: 'button', class: 'btn--primary', hidden: true }, '開啟搶答');
const close = h('button', { type: 'button', class: 'btn--primary', hidden: true }, '結束搶答');
const empty = h('p', { hidden: true }, '匯入題目後即可開啟搶答。');
const monitor = h('div');
let current;

panel.setAttribute('aria-labelledby', 'teacher-buzzer-heading');
panel.append(
  h('h2', { id: 'teacher-buzzer-heading' }, '即時搶答'),
  phase, connection,
  h('div', { class: 'actions' }, open, close),
  feedback, empty, monitor,
);

function showError(message) {
  setText(feedback, message);
  feedback.hidden = !message;
}

function refreshControls(state) {
  const { status, mode } = state.activity;
  const label = `${phaseLabel[status]}・${mode === 'FAIR' ? '公平模式' : '速度模式'}`;
  if (phase.textContent !== label) setText(phase, label);
  open.hidden = status !== 'PREPARING';
  close.hidden = status !== 'OPEN';
  open.disabled = state.busy || !state.snapshot?.units.length || !state.snapshot.importRevision;
  close.disabled = state.busy;
}

function createUnitView() {
  const heading = h('h3');
  const winner = h('p');
  const noGroups = h('p', null, '尚未有組別加入。');
  const header = h('tr');
  const body = h('tbody');
  const scroll = h('div', { class: 'buzzer-monitor-scroll', tabindex: '0', role: 'region' },
    h('table', { class: 'buzzer-monitor-table' }, h('thead', null, header), body),
  );
  const node = h('section', null, heading, winner, noGroups, scroll);
  return { node, heading, winner, noGroups, scroll, header, body };
}

function renderUnit(view, unit, groups, activity) {
  const questions = unit.questions;
  const title = questions.map(({ key }) => `第 ${key} 題`).join('、');
  const accepted = new Map(unit.submissions.map((entry) => [entry.groupId, entry]));
  const rows = groups.map((group) => {
    const submission = accepted.get(group.id);
    const answers = new Map(submission?.answers.map((answer) => [answer.questionKey, answer.text]));
    return h('tr', null,
      h('th', { scope: 'row' }, group.name),
      h('td', null, submission ? '已送出' : '未送出'),
      h('td', null, submission?.acceptSeq ?? '—'),
      ...questions.map(({ key }) => h('td', { class: 'answer-text' }, answers.get(key) ?? '—')),
    );
  });
  const columns = ['組別', '送出狀態', '受理順序', ...questions.map(({ key }) => `第 ${key} 題答案`)];
  const winner = groups.find((group) => group.id === unit.winnerGroupId);
  const winnerLabel = activity.mode === 'FAIR' ? '勝出：結束時計算' : `暫定勝出：${winner?.name ?? '尚無'}`;
  setText(view.heading, unit.kind === 'GROUP' ? `題組（${title}）` : title);
  setText(view.winner, winnerLabel);
  view.winner.hidden = activity.status !== 'OPEN';
  view.noGroups.hidden = rows.length > 0;
  view.scroll.hidden = rows.length === 0;
  view.scroll.setAttribute('aria-label', `${title}監看`);
  view.header.replaceChildren(...columns.map((label) => h('th', { scope: 'col' }, label)));
  view.body.replaceChildren(...rows);
}

function updateActivity(state, activity) {
  state.activity = activity;
  refreshControls(state);
  const phaseKey = `${activity.status}:${activity.mode}`;
  if (state.announcedPhase !== phaseKey) {
    state.announcedPhase = phaseKey;
    document.dispatchEvent(new CustomEvent('teacher-activity-phase', { detail: activity }));
  }
}

function updateSnapshot(state, snapshot) {
  if (snapshot?.activity?.id !== state.activity.id || phaseWentBack(state.activity.status, snapshot.activity.status)) return;
  state.snapshot = snapshot;
  updateActivity(state, snapshot.activity);
  const { imported, importRevision } = snapshot;
  if (typeof importRevision === 'string' && state.announcedImportRevision !== importRevision) {
    state.announcedImportRevision = importRevision;
    document.dispatchEvent(new CustomEvent('teacher-import-changed', {
      detail: { activityId: snapshot.activity.id, imported, importRevision },
    }));
  }
  if (!state.controlError) showError('');
  renderMonitor(state);
}

function renderMonitor(state) {
  if (!state.snapshot) return;
  // Once closed, SF-04's fixed results (#results-export) replace the live monitor.
  monitor.hidden = state.activity.status === 'CLOSED';
  const { groups, units } = state.snapshot;
  empty.hidden = units.length > 0;
  const currentIds = new Set(units.map((unit) => unit.id));
  for (const [id, view] of state.views) {
    if (currentIds.has(id)) continue;
    view.node.remove();
    state.views.delete(id);
  }
  units.forEach((unit, index) => {
    let view = state.views.get(unit.id);
    if (!view) {
      view = createUnitView();
      state.views.set(unit.id, view);
    }
    if (monitor.children[index] !== view.node) monitor.insertBefore(view.node, monitor.children[index] ?? null);
    renderUnit(view, unit, groups, state.activity);
  });
}

async function changePhase(action) {
  const state = current;
  const requiredPhase = action === 'open' ? 'PREPARING' : 'OPEN';
  if (!state || state.busy || state.activity.status !== requiredPhase || (action === 'open' && open.disabled)) return;
  if (action === 'close' && !confirm('確定結束這場搶答？結束後將停止接受答案。')) return;
  state.busy = true;
  state.controlError = false;
  showError('');
  refreshControls(state);
  try {
    const response = await apiFetch(`${state.baseUrl}/${action}`, {
      method: 'POST',
      body: action === 'close' ? { confirm: true } : { importRevision: state.snapshot.importRevision },
      signal: AbortSignal.any([state.controller.signal, AbortSignal.timeout(10_000)]),
    });
    if (current !== state) return;
    if (response?.activity?.id !== state.activity.id) throw new Error('沒有收到活動階段確認。');
    if (!phaseWentBack(state.activity.status, response.activity.status)) {
      updateActivity(state, response.activity);
      renderMonitor(state);
    }
  } catch (error) {
    if (current === state) {
      state.controlError = true;
      showError(error.message);
    }
  } finally {
    state.busy = false;
    if (current === state) refreshControls(state);
  }
}

open.addEventListener('click', () => void changePhase('open'));
close.addEventListener('click', () => void changePhase('close'));
document.addEventListener('teacher-activity', ({ detail: activity }) => {
  if (!activity) {
    current?.controller.abort();
    current = null;
    panel.hidden = true;
    monitor.replaceChildren();
    return;
  }
  if (current?.activity.id === activity.id) return;
  current?.controller.abort();
  const state = {
    activity, controller: new AbortController(), busy: false, controlError: false, views: new Map(),
    baseUrl: `/api/teacher/activities/${encodeURIComponent(activity.id)}`,
  };
  current = state;
  panel.hidden = false;
  empty.hidden = true;
  monitor.replaceChildren();
  showError('');
  refreshControls(state);
  watchActivity({
    snapshotUrl: `${state.baseUrl}/live`, eventsUrl: `${state.baseUrl}/events`, signal: state.controller.signal,
    onSnapshot: (snapshot) => updateSnapshot(state, snapshot),
    onConnection: (message) => setText(connection, message),
    onError: (message) => { if (!state.controlError) showError(message); },
  });
});
