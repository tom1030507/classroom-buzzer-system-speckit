import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildResultsCsv } from '../../../src/features/results-export/csv.js';

const T1 = '2026-11-20T08:01:02.345Z';
const T2 = '2026-11-20T08:01:03.000Z';
const T3 = '2026-11-20T08:01:04.500Z';
const entry = (groupName, rank, acceptedOrder, acceptedAt, answers) => ({
  groupName, rank, acceptedOrder, acceptedAt, isWinner: rank === 1,
  answers: Object.entries(answers).map(([questionKey, text]) => ({ questionKey, text })),
});

/** Units and entries deliberately out of order: the CSV follows unit position and final rank. */
function resultView() {
  return {
    activity: { id: 'activity-1', mode: 'SPEED', status: 'CLOSED', closedAt: '2026-11-20T08:30:00.000Z' },
    units: [
      { id: 12, kind: 'GROUP', label: 'G:A', position: 2, questions: [{ key: '2' }, { key: '-3' }], noAnswer: false, entries: [
        entry('乙組', 1, 1, T2, { 2: '\t@SUM(A1)', '-3': '\r\n第二行' }),
      ] },
      { id: 13, kind: 'SINGLE', label: 'Q:5', position: 3, questions: [{ key: '5' }], noAnswer: true, entries: [] },
      { id: 11, kind: 'SINGLE', label: 'Q:1', position: 1, questions: [{ key: '1' }], noAnswer: false, entries: [
        entry('=HYPERLINK("x")', 2, 2, T3, { 1: '  +1' }),
        entry('甲組', 1, 1, T1, { 1: '他說"好",然後\n離開' }),
      ] },
    ],
  };
}

test('AC-19 the CSV has a BOM, CRLF line endings, the fixed columns and one row per answered question', () => {
  assert.equal(buildResultsCsv(resultView()), [
    '﻿activity_id,mode,unit_id,question_id,group_name,answer,accepted_at,accepted_order,rank,is_winner',
    `activity-1,SPEED,Q:1,1,甲組,"他說""好"",然後\n離開",${T1},1,1,true`,
    `activity-1,SPEED,Q:1,1,"'=HYPERLINK(""x"")",'  +1,${T3},2,2,false`,
    `activity-1,SPEED,G:A,2,乙組,'\t@SUM(A1),${T2},1,1,true`,
    `activity-1,SPEED,G:A,'-3,乙組,"'\r\n第二行",${T2},1,1,true`,
    'activity-1,SPEED,Q:5,5,,,,,,false',
    '',
  ].join('\r\n'));
});

test('AC-20 only values that spreadsheet software could run as formulas get the guard quote', () => {
  const guarded = (text) => {
    const view = resultView();
    view.units[2].entries[1].answers[0].text = text;
    return buildResultsCsv(view).split('\r\n')[1].split(',')[5];
  };
  for (const text of ['=1+1', '+1', '-1', '@A1', '  =1', '　=1']) assert.equal(guarded(text), `'${text}`);
  assert.equal(guarded('\tplain'), "'\tplain");
  for (const text of ['plain', '1+1', 'a=b', ' 中文', "'quoted"]) assert.equal(guarded(text), text);
});

test('building the CSV never changes the results it reads', () => {
  const view = resultView();
  const before = structuredClone(view);
  buildResultsCsv(view);
  assert.deepEqual(view, before);
});
