/**
 * Fair-mode ranking (spec.md §4, specs/005-fair-ranking/contracts/fair-ranking.md).
 *
 * A synchronous pure function: it runs inside the close transaction, so it never touches the
 * database, the clock or any state that outlives the call.
 *
 * Units are processed in the given order (the fixed unit order of the import preview). Every group
 * starts with zero wins. Inside a unit the submissions are ordered by earlier wins (fewer first),
 * then by the server's acceptance sequence (smaller first). The first one wins the unit and its
 * group gains one win. A unit nobody answered adds no win; a group that skipped a unit is not ranked
 * in it; a group unit is a single submission, so it counts as one win.
 *
 * @param {{ unitId: number,
 *           submissions: { submissionId: number, groupId: number, acceptSeq: number }[] }[]} units
 * @returns {{ submissionId: number, unitId: number, finalRank: number }[]}
 *   one entry per submission, in unit order and by final rank inside a unit
 */
export function rankFair(units) {
  const wins = new Map();
  const winsOf = (groupId) => wins.get(groupId) ?? 0;
  const ranked = [];
  for (const { unitId, submissions } of units) {
    const order = [...submissions].sort(
      (a, b) => winsOf(a.groupId) - winsOf(b.groupId) || a.acceptSeq - b.acceptSeq,
    );
    order.forEach(({ submissionId }, index) => ranked.push({ submissionId, unitId, finalRank: index + 1 }));
    if (order.length > 0) wins.set(order[0].groupId, winsOf(order[0].groupId) + 1);
  }
  return ranked;
}
