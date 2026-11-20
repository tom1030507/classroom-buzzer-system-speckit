/**
 * Renders the fixed results (SF-04 ResultView) for both the teacher and the student pages, led by the
 * rule description of the activity's mode (SF-05). Group names and answers are user input, so they
 * only ever become text nodes (dom.js).
 */
import { h } from '/js/dom.js';
import { modeLabel, renderModeRule } from '/js/mode-rules.js';

// The names moved to mode-rules.js (SF-05); the result modules still import modeLabel from here.
export { modeLabel };

const timeFormat = new Intl.DateTimeFormat('zh-TW', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23',
});

export function unitTitle(unit) {
  const keys = unit.questions.map(({ key }) => `第 ${key} 題`).join('、');
  return unit.kind === 'GROUP' ? `題組（${keys}）` : keys;
}

function entryRow(entry, questions) {
  const answers = new Map(entry.answers.map(({ questionKey, text }) => [questionKey, text]));
  return h('tr', null,
    h('td', null, entry.isWinner ? `${entry.rank}（勝出）` : String(entry.rank)),
    h('th', { scope: 'row' }, entry.groupName),
    h('td', null, String(entry.acceptedOrder)),
    h('td', null, h('time', { datetime: entry.acceptedAt }, timeFormat.format(new Date(entry.acceptedAt)))),
    ...questions.map(({ key }) => h('td', { class: 'answer-text' }, answers.get(key) ?? '')),
  );
}

function unitSection(unit, mode, idPrefix) {
  const title = unitTitle(unit);
  const headingId = `${idPrefix}-${unit.id}`;
  const heading = h('h3', { id: headingId }, title);
  if (unit.noAnswer) {
    return h('section', { 'aria-labelledby': headingId }, heading, h('p', null, '無人作答：沒有任何組送出，這題沒有勝出組。'));
  }
  const winner = unit.entries.find((entry) => entry.isWinner);
  const columns = ['最終順位', '組別', '受理順序', '受理時間', ...unit.questions.map(({ key }) => `第 ${key} 題答案`)];
  return h('section', { 'aria-labelledby': headingId },
    heading,
    h('p', null, `勝出：${winner?.groupName ?? '無'}`),
    h('div', { class: 'results-scroll', role: 'region', tabindex: '0', 'aria-label': `${title}結果` },
      h('table', { class: 'results-table' },
        h('caption', { class: 'visually-hidden' }, `${title}的受理順序與最終順位（${modeLabel[mode] ?? mode}）`),
        h('thead', null, h('tr', null, ...columns.map((label) => h('th', { scope: 'col' }, label)))),
        h('tbody', null, ...unit.entries.map((entry) => entryRow(entry, unit.questions))),
      ),
    ),
  );
}

/**
 * @returns {HTMLElement[]} the rule description of the activity's mode (both modes show theirs, FR-010;
 *   the fair-mode text carries a short example, FR-014), then one section per unit in the fixed unit order
 */
export function renderResults(view, { idPrefix = 'results-unit' } = {}) {
  return [
    renderModeRule(view.activity.mode),
    ...view.units.map((unit) => unitSection(unit, view.activity.mode, idPrefix)),
  ];
}
