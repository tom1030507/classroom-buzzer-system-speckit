import { apiFetch, setDefaultHeader } from '/js/api.js';
import { h, setText } from '/js/dom.js';

const status = document.querySelector('#teacher-status');
const loginForm = document.querySelector('#teacher-login');
const password = document.querySelector('#teacher-password');
const activities = document.querySelector('#teacher-activities');
const currentActivity = document.querySelector('#teacher-activity');
const groupList = document.querySelector('#teacher-groups');
let selectedId;

function showStatus(message) {
  setText(status, message);
  status.hidden = !message;
}

function renderActivity({ activity, groups }) {
  currentActivity.hidden = !activity;
  selectedId = activity?.id;
  setText(document.querySelector('#join-code'), activity?.joinCode);
  groupList.replaceChildren(...groups.map((group) => h('li', null, group.name)));
  document.dispatchEvent(new CustomEvent('teacher-activity', { detail: activity }));
}

async function updateSession(session) {
  setDefaultHeader('X-CSRF-Token', session.csrfToken);
  loginForm.hidden = session.authenticated || session.setupRequired;
  activities.hidden = !session.authenticated;
  if (!session.authenticated) {
    renderActivity({ activity: null, groups: [] });
    showStatus(session.setupRequired ? '請在伺服器終端機執行 npm run setup:teacher，設定教師密碼後重新整理。' : '請登入教師帳號。');
    return;
  }
  const snapshot = await apiFetch('/api/teacher/activities/current');
  renderActivity(snapshot);
  showStatus(snapshot.activity ? '' : '請建立活動。');
}

async function perform(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    showStatus(error.message);
  } finally {
    button.disabled = false;
  }
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  void perform(loginForm.querySelector('button'), async () => {
    const session = await apiFetch('/api/teacher/login', { method: 'POST', body: { password: password.value } });
    loginForm.reset();
    await updateSession(session);
  });
});

const create = document.querySelector('#create-activity');
create.addEventListener('click', () => void perform(create, async () => {
  renderActivity(await apiFetch('/api/teacher/activities', { method: 'POST' }));
  showStatus('');
}));

const refresh = document.querySelector('#refresh-groups');
refresh.addEventListener('click', () => void perform(refresh, async () => {
  const activityId = selectedId;
  const snapshot = await apiFetch(`/api/teacher/activities/${encodeURIComponent(activityId)}`);
  if (selectedId === activityId) renderActivity(snapshot);
}));

const logout = document.querySelector('#teacher-logout');
logout.addEventListener('click', () => void perform(logout, async () => {
  await updateSession(await apiFetch('/api/teacher/logout', { method: 'POST' }));
}));

apiFetch('/api/teacher/session').then(updateSession).catch((error) => showStatus(error.message));
