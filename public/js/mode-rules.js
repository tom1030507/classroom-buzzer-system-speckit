/**
 * Mode names and rule descriptions (SF-05, spec.md §2 and §4).
 * The teacher's mode selector, the student's mode panel and the result page all show this one
 * fixed text. It holds no activity data, so it needs no API and cannot leak another group's
 * information (FR-010). The fair-mode example uses generic wording on purpose, so it is never
 * mistaken for real group names (FR-014).
 */
import { h } from '/js/dom.js';

export const modeLabel = Object.freeze({ SPEED: '速度模式', FAIR: '公平模式' });

/** One paragraph per element. The last fair-mode paragraph is the short example. */
export const modeRule = Object.freeze({
  SPEED: Object.freeze([
    '每個單位由最先被伺服器受理的組別勝出。',
  ]),
  FAIR: Object.freeze([
    '結束時依單位順序逐一計算順位：此前單位勝出次數較少的組優先，勝出次數相同時，先被伺服器受理的組優先。',
    '每個單位的第 1 名勝出，該組的勝出次數加一次；題組只算一次，沒有人作答的單位不增加次數。',
    '範例：某組已勝出 1 次、另一組勝出 0 次，即使前者先送出，這個單位仍由勝出 0 次的組排在前面。',
  ]),
});

/** @returns {HTMLElement} the rule description of `mode`; an empty container for an unknown mode */
export function renderModeRule(mode) {
  const lines = Object.hasOwn(modeRule, mode) ? modeRule[mode] : [];
  return h('div', { class: 'mode-rule' }, lines.map((line) => h('p', null, line)));
}
