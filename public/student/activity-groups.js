import { apiFetch, setDefaultHeader } from '/js/api.js';
import { setText } from '/js/dom.js';

const leaveButton = document.querySelector('#student-leave');
let leaveActivityId;
const status = document.querySelector('#student-status');
const form = document.querySelector('#student-join');

function updateSession(session) {
  setDefaultHeader('X-CSRF-Token', session.csrfToken);
  form.hidden = !!session.group && session.activity.status !== 'CLOSED';
  setText(status, session.group ? `已加入「${session.group.name}」` : '請輸入加入碼與組名。');
  document.dispatchEvent(new CustomEvent('student-activity', { detail: session.activity }));
}

function syncLeavePhase({ detail: activity }) {
  if (activity?.id === leaveActivityId) leaveButton.hidden = activity?.status !== 'PREPARING';
}

document.addEventListener('student-activity', (event) => {
  leaveActivityId = event.detail?.id;
  syncLeavePhase(event);
});
document.addEventListener('student-activity-phase', syncLeavePhase);
document.addEventListener('student-activity-closed', syncLeavePhase);

leaveButton.addEventListener('click', async () => {
  if (!window.confirm('確定退出目前活動？退出會移除此組別與工作階段。')) return;
  leaveButton.disabled = true;
  try {
    updateSession(await apiFetch('/api/student/leave', { method: 'POST' }));
  } catch (error) {
    if (['NETWORK_ERROR', 'GROUP_REQUIRED', 'INVALID_CSRF', 'INVALID_PHASE'].includes(error.code)) {
      try {
        const session = await apiFetch('/api/student/session');
        updateSession(session);
        if (!session.group) return;
      } catch {
        // Keep the original leave error visible when the session cannot be refreshed.
      }
    }
    setText(status, error.message);
  } finally {
    leaveButton.disabled = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    updateSession(await apiFetch('/api/student/join', {
      method: 'POST',
      body: {
        joinCode: document.querySelector('#student-join-code').value,
        name: document.querySelector('#student-name').value,
      },
    }));
    form.reset();
  } catch (error) {
    if (error.code === 'NETWORK_ERROR' || error.code === 'INVALID_CSRF') {
      try {
        const session = await apiFetch('/api/student/session');
        updateSession(session);
        if (session.group && session.activity.status !== 'CLOSED') return;
      } catch {
        // Keep the original join error visible when the session cannot be refreshed.
      }
    }
    setText(status, error.message);
  } finally {
    button.disabled = false;
  }
});

apiFetch('/api/student/session').then(updateSession).catch((error) => setText(status, error.message));
