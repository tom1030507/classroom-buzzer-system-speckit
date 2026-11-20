/**
 * Results CSV (spec.md FR-09; research R11). Built from the same ResultView as the result
 * pages and the Sheets write-back, so all three always agree.
 */

const COLUMNS = [
  'activity_id', 'mode', 'unit_id', 'question_id', 'group_name', 'answer',
  'accepted_at', 'accepted_order', 'rank', 'is_winner',
];
const FORMULA_START = /^[=+\-@]/;
const CONTROL_START = /^[\t\r\n]/;

/**
 * Spreadsheet software may run user input that starts like a formula. A leading quote makes it
 * plain text; only the exported copy changes, never the stored answer (FR-09, AC-20).
 */
function guard(value) {
  return CONTROL_START.test(value) || FORMULA_START.test(value.trimStart()) ? `'${value}` : value;
}

function field(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildResultsCsv(view) {
  const { id, mode } = view.activity;
  const rows = [COLUMNS];
  for (const unit of [...view.units].sort((a, b) => a.position - b.position)) {
    const unitId = guard(unit.label);
    if (unit.entries.length === 0) {
      for (const { key } of unit.questions) rows.push([id, mode, unitId, guard(key), '', '', '', '', '', 'false']);
      continue;
    }
    for (const entry of [...unit.entries].sort((a, b) => a.rank - b.rank)) {
      const answers = new Map(entry.answers.map(({ questionKey, text }) => [questionKey, text]));
      for (const { key } of unit.questions) {
        rows.push([
          id, mode, unitId, guard(key), guard(entry.groupName), guard(answers.get(key) ?? ''),
          entry.acceptedAt, entry.acceptedOrder, entry.rank, entry.isWinner ? 'true' : 'false',
        ]);
      }
    }
  }
  return `﻿${rows.map((row) => row.map(field).join(',')).join('\r\n')}\r\n`;
}
