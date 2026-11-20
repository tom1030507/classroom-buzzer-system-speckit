/**
 * SF-05 mode and rules for a joined student (FR-010, FR-011). The text is fixed and holds nothing
 * about other groups. Once the activity closes, the result page shows the mode and its rule instead.
 */
import { h, setText } from '/js/dom.js';
import { modeLabel, renderModeRule } from '/js/mode-rules.js';

const panel = document.querySelector('#student-mode');
const heading = h('h2', { id: 'student-mode-heading' }, '本場活動模式');
const name = h('p', { class: 'status' });
const rule = h('div');

panel.setAttribute('aria-labelledby', heading.id);
panel.append(heading, name, rule);

function show(activity) {
  const visible = Boolean(activity) && activity.status !== 'CLOSED';
  panel.hidden = !visible;
  if (!visible) {
    setText(name, '');
    rule.replaceChildren();
    return;
  }
  setText(name, `目前模式：${modeLabel[activity.mode] ?? activity.mode}`);
  rule.replaceChildren(renderModeRule(activity.mode));
}

document.addEventListener('student-activity', ({ detail }) => show(detail));
// SF-03 announces status and mode changes from its live snapshot (T015), so a change shows up here.
document.addEventListener('student-activity-phase', ({ detail }) => show(detail));
document.addEventListener('student-activity-closed', ({ detail }) => show(detail));
