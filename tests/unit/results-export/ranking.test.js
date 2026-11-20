import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RANKERS, rankSpeed } from '../../../src/features/results-export/ranking.js';

const unit = (unitId, ...submissions) => ({
  unitId,
  submissions: submissions.map(([submissionId, groupId, acceptSeq]) => ({ submissionId, groupId, acceptSeq })),
});

test('speed ranking orders each unit by server acceptance sequence and skips units without submissions', () => {
  const ranks = rankSpeed([
    unit(10, [1, 100, 1], [4, 200, 7]),
    unit(11),
    unit(12, [3, 200, 3], [5, 100, 9], [6, 300, 12]),
  ]);
  assert.deepEqual(ranks, [
    { submissionId: 1, unitId: 10, finalRank: 1 },
    { submissionId: 4, unitId: 10, finalRank: 2 },
    { submissionId: 3, unitId: 12, finalRank: 1 },
    { submissionId: 5, unitId: 12, finalRank: 2 },
    { submissionId: 6, unitId: 12, finalRank: 3 },
  ]);
});

test('speed ranking follows acceptSeq even when submissions arrive out of order, per unit', () => {
  const ranks = rankSpeed([unit(20, [8, 100, 5], [7, 200, 2]), unit(21, [9, 100, 6])]);
  assert.deepEqual(ranks, [
    { submissionId: 7, unitId: 20, finalRank: 1 },
    { submissionId: 8, unitId: 20, finalRank: 2 },
    { submissionId: 9, unitId: 21, finalRank: 1 },
  ]);
});

test('the speed ranking is registered for SPEED and the registry cannot be changed at runtime', () => {
  assert.equal(RANKERS.SPEED, rankSpeed);
  assert.ok(Object.isFrozen(RANKERS));
});
