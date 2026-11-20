import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSheets } from '../../../src/features/sheets-import/parser.js';

function block(startRow, startColumn, ...rows) {
  return {
    startRow,
    startColumn,
    rowData: rows.map((row) => ({
      values: row.map((cell) => ({
        userEnteredValue: typeof cell === 'object' ? cell : { stringValue: cell },
      })),
    })),
  };
}

test('AC-02 and AC-17 preserve teacher sheet order, row-major positions and groups across sheets', () => {
  const sheets = [
    { id: 19, title: '第二張', data: [
      block(7, 26, ['{{Q:85|G:g.1}}']),
      block(3, 2, ['　{{Q:7}} ', '標題', '{{Q:2a|G:g.1}}']),
    ] },
    { id: 3, title: '第一張', data: [
      block(9, 52, ['{{Q:99-z}}', '{{Q:Q_6|G:g.1}}']),
    ] },
  ];
  const actual = parseSheets('cloud-spreadsheet', sheets);
  assert.equal(actual.spreadsheetId, 'cloud-spreadsheet');
  assert.equal(actual.questionCount, 5);
  assert.equal(actual.unitCount, 3);
  assert.deepEqual(actual.units.map(({ kind, groupCode, position, questions }) => ({
    kind, groupCode, position,
    questions: questions.map((q) => [q.key, q.position, q.positionInUnit, q.sheetId, q.rowIndex, q.columnIndex, q.cell]),
  })), [
    { kind: 'SINGLE', groupCode: null, position: 1, questions: [['7', 1, 1, 19, 3, 2, 'C4']] },
    { kind: 'GROUP', groupCode: 'g.1', position: 2, questions: [
      ['2a', 2, 1, 19, 3, 4, 'E4'], ['85', 3, 2, 19, 7, 26, 'AA8'], ['Q_6', 5, 3, 3, 9, 53, 'BB10'],
    ] },
    { kind: 'SINGLE', groupCode: null, position: 3, questions: [['99-z', 4, 1, 3, 9, 52, 'BA10']] },
  ]);
  assert.equal(actual.units[0].questions[0].originalMarker, '　{{Q:7}} ');
});

test('AC-03 ignores ordinary text and formulas and rejects a sheet with no literal markers', () => {
  const data = [block(0, 0, ['講義內容', '{{OTHER}}', '｛｛Ｑｕｅｓｔｉｏｎ｝｝', { formulaValue: '="{{Q:1}}"' }, { numberValue: 42 }])];
  assert.throws(() => parseSheets('sheet', [{ id: 0, title: 'A', data }]), { code: 'IMPORT_NO_QUESTIONS' });
});

for (const marker of ['{{Q:}}', '{{Q:A B}}', '{{Q:X|G:}}', '{{Q:X|G:A/B}}', '{{Q:一}}',
  '{{Q:1}', '文字 {{Q:1}}', '{{Q:1}} 文字', '{{q:1}}', '{{Q}}', '{{Q1}}',
  '｛｛Q:1｝｝', '{｛Q:1}}', '｛｛Ｑ：2｜Ｇ：A｝｝']) {
  test(`AC-03 rejects malformed marker ${marker}`, () => {
    const data = [block(0, 0, ['{{Q:valid}}', marker])];
    assert.throws(() => parseSheets('sheet', [{ id: 0, title: 'A', data }]), { code: 'IMPORT_INVALID_MARKER' });
  });
}

test('AC-03 rejects an activity-wide duplicate across sheets and a singleton question group', () => {
  const left = { id: 0, title: 'A', data: [block(0, 0, ['{{Q:one}}'])] };
  const right = { id: 1, title: 'B', data: [block(0, 0, ['{{Q:one|G:team}}'])] };
  assert.throws(() => parseSheets('sheet', [left, right]), { code: 'IMPORT_DUPLICATE_QUESTION' });
  assert.throws(() => parseSheets('sheet', [right]), { code: 'IMPORT_SINGLE_MEMBER_GROUP' });
});

test('AC-03 rejects a merged marker, respecting exclusive end coordinates', () => {
  const merges = [{ startRowIndex: 2, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 3 }];
  const sheet = { id: 4, title: 'A', merges, data: [block(2, 1, ['{{Q:bad}}'])] };
  assert.throws(() => parseSheets('sheet', [sheet]), { code: 'IMPORT_MERGED_CELL' });
  const result = parseSheets('sheet', [{ ...sheet, data: [block(4, 3, ['{{Q:ok}}'])] }]);
  assert.equal(result.units[0].questions[0].cell, 'D5');
});
