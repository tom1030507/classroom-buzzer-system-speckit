import { apiFetch, setDefaultHeader } from '/js/api.js';
import { setText } from '/js/dom.js';

const status = document.querySelector('#student-status');
const form = document.querySelector('#student-join');

function updateSession(session) {
  setDefaultHeader('X-CSRF-Token', session.csrfToken);
  form.hidden = !!session.group && session.activity.status !== 'CLOSED';
  setText(status, session.group ? `已加入「${session.group.name}」` : '請輸入加入碼與組名。');
  document.dispatchEvent(new CustomEvent('student-activity', { detail: session.activity }));
}

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
    setText(status, error.message);
  } finally {
    button.disabled = false;
  }
});

apiFetch('/api/student/session').then(updateSession).catch((error) => setText(status, error.message));
