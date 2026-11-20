import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { rankFair } from '../../../src/features/fair-ranking/fair-ranking.js';

// Test vectors from specs/005-fair-ranking/contracts/fair-ranking.md. Groups: A = 1, B = 2, C = 3.
const A = 1;
const B = 2;
const C = 3;
const s = (submissionId, groupId, acceptSeq) => ({ submissionId, groupId, acceptSeq });
const rank = (submissionId, unitId, finalRank) => ({ submissionId, unitId, finalRank });

function deepFreeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') deepFreeze(child);
  return Object.freeze(value);
}

describe('rankFair test vectors', () => {
  test('V1 AC-21: A answers both units first, so B ranks first in the second unit', () => {
    const units = [
      { unitId: 1, submissions: [s(11, A, 1), s(12, B, 2)] },
      { unitId: 2, submissions: [s(21, A, 3), s(22, B, 4)] },
    ];
    assert.deepEqual(rankFair(units), [rank(11, 1, 1), rank(12, 1, 2), rank(22, 2, 1), rank(21, 2, 2)]);
  });

  test('V2 AC-22: equal win counts follow the acceptance sequence and the group with more wins ranks last', () => {
    const units = [
      { unitId: 1, submissions: [s(11, A, 1), s(12, B, 2), s(13, C, 3)] },
      { unitId: 2, submissions: [s(21, A, 4), s(22, C, 5), s(23, B, 6)] },
    ];
    assert.deepEqual(rankFair(units), [
      rank(11, 1, 1), rank(12, 1, 2), rank(13, 1, 3),
      rank(22, 2, 1), rank(23, 2, 2), rank(21, 2, 3),
    ]);
  });

  test('V3 AC-22: a unit nobody answered adds no win, and a group unit counts as one win', () => {
    const units = [
      { unitId: 1, submissions: [] },
      { unitId: 2, submissions: [s(21, A, 1), s(22, B, 2)] },
      { unitId: 3, submissions: [s(31, A, 3), s(32, B, 4)] },
    ];
    assert.deepEqual(rankFair(units), [rank(21, 2, 1), rank(22, 2, 2), rank(32, 3, 1), rank(31, 3, 2)]);
  });

  test('V4: a group that skipped a unit is not ranked there and does not gain a win', () => {
    const units = [
      { unitId: 1, submissions: [s(11, A, 1), s(12, B, 2)] },
      { unitId: 2, submissions: [s(21, C, 3), s(22, A, 4)] },
      { unitId: 3, submissions: [s(31, A, 5), s(32, B, 6), s(33, C, 7)] },
    ];
    assert.deepEqual(rankFair(units), [
      rank(11, 1, 1), rank(12, 1, 2),
      rank(21, 2, 1), rank(22, 2, 2),
      rank(32, 3, 1), rank(31, 3, 2), rank(33, 3, 3),
    ]);
  });

  test('V5: a single group wins every unit it answers', () => {
    const units = [
      { unitId: 1, submissions: [s(11, A, 1)] },
      { unitId: 2, submissions: [s(21, A, 2)] },
      { unitId: 3, submissions: [s(31, A, 3)] },
    ];
    assert.deepEqual(rankFair(units), [rank(11, 1, 1), rank(21, 2, 1), rank(31, 3, 1)]);
  });

  test('V6: units are processed in array order, not by unitId', () => {
    const units = [
      { unitId: 2, submissions: [s(21, A, 3), s(22, B, 4)] },
      { unitId: 1, submissions: [s(11, A, 1), s(12, B, 2)] },
    ];
    assert.deepEqual(rankFair(units), [rank(21, 2, 1), rank(22, 2, 2), rank(12, 1, 1), rank(11, 1, 2)]);
  });

  test('V7: no input and no answers produce no ranks', () => {
    assert.deepEqual(rankFair([]), []);
    assert.deepEqual(rankFair([{ unitId: 1, submissions: [] }, { unitId: 2, submissions: [] }]), []);
  });
});

describe('rankFair purity', () => {
  const v1 = () => [
    { unitId: 1, submissions: [s(11, A, 1), s(12, B, 2)] },
    { unitId: 2, submissions: [s(21, A, 3), s(22, B, 4)] },
  ];

  test('does not modify its input', () => {
    const units = deepFreeze(v1());
    assert.doesNotThrow(() => rankFair(units));
  });

  test('returns the same ranks for the same input', () => {
    assert.deepEqual(rankFair(v1()), rankFair(v1()));
  });

  test('keeps no win history between calls, so another activity starts from zero (US1 scenario 6)', () => {
    const other = [
      { unitId: 7, submissions: [s(71, B, 1), s(72, A, 2)] },
      { unitId: 8, submissions: [s(81, A, 3), s(82, B, 4)] },
    ];
    const alone = rankFair(other);
    rankFair(v1());
    assert.deepEqual(rankFair(other), alone);
    assert.deepEqual(alone, [rank(71, 7, 1), rank(72, 7, 2), rank(81, 8, 1), rank(82, 8, 2)]);
  });
});

// A small seeded generator keeps the invariant test deterministic.
function mulberry32(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** 1–10 groups and 1–20 units; submissions happen in a random global order, like real acceptance. */
function randomScenario(random) {
  const groups = 1 + Math.floor(random() * 10);
  const unitCount = 1 + Math.floor(random() * 20);
  const pairs = [];
  for (let unitId = 1; unitId <= unitCount; unitId += 1) {
    for (let groupId = 1; groupId <= groups; groupId += 1) if (random() < 0.7) pairs.push({ unitId, groupId });
  }
  const units = Array.from({ length: unitCount }, (_, index) => ({ unitId: index + 1, submissions: [] }));
  shuffle(pairs, random).forEach(({ unitId, groupId }, index) => {
    units[unitId - 1].submissions.push({ submissionId: index + 1, groupId, acceptSeq: index + 1 });
  });
  for (const unit of units) unit.submissions.sort((a, b) => a.acceptSeq - b.acceptSeq);
  return units;
}

function assertInvariants(units, ranked) {
  const source = new Map(units.flatMap((unit) => unit.submissions.map((sub) => [sub.submissionId, sub])));
  // 2. every input submission appears exactly once, and the output follows the unit order
  assert.deepEqual(
    ranked.map((entry) => entry.submissionId).sort((a, b) => a - b),
    [...source.keys()].sort((a, b) => a - b),
  );
  assert.deepEqual(
    ranked.map((entry) => entry.unitId),
    units.flatMap((unit) => unit.submissions.map(() => unit.unitId)),
  );

  const wins = new Map();
  for (const unit of units) {
    const entries = ranked.filter((entry) => entry.unitId === unit.unitId);
    // 1 and 4. ranks are exactly 1..n, so each answered unit has exactly one rank 1
    assert.deepEqual(entries.map((entry) => entry.finalRank), entries.map((_, index) => index + 1));
    // 3. ascending by (earlier wins, acceptSeq); earlier wins are recounted from the output itself
    const keys = entries.map(({ submissionId }) => {
      const { groupId, acceptSeq } = source.get(submissionId);
      return { groupId, wins: wins.get(groupId) ?? 0, acceptSeq };
    });
    for (let i = 1; i < keys.length; i += 1) {
      const before = keys[i - 1];
      const after = keys[i];
      assert.ok(
        before.wins < after.wins || (before.wins === after.wins && before.acceptSeq < after.acceptSeq),
        `unit ${unit.unitId}: rank ${i} must not come after rank ${i + 1}`,
      );
    }
    if (keys.length > 0) wins.set(keys[0].groupId, keys[0].wins + 1);
  }
}

describe('rankFair invariants (SC-001)', () => {
  test('hold for 200 seeded random activities of up to 10 groups and 20 units', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const units = randomScenario(mulberry32(seed));
      assertInvariants(units, rankFair(units));
    }
  });
});
