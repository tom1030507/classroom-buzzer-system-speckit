/**
 * Final-rank strategies by activity mode (specs/004-results-export/contracts/ranking.md).
 * A strategy is a synchronous pure function: it receives the units in their fixed order,
 * each with its accepted submissions, and returns the final rank of every submission
 * (1, 2, 3… within a unit). It runs inside the close transaction, so it must not await.
 */

/** Speed mode: within each unit, the earliest server acceptance wins (spec.md §2). */
export function rankSpeed(units) {
  return units.flatMap(({ unitId, submissions }) => [...submissions]
    .sort((a, b) => a.acceptSeq - b.acceptSeq)
    .map(({ submissionId }, index) => ({ submissionId, unitId, finalRank: index + 1 })));
}

// SF-05 adds FAIR (spec.md §4). Until then a fair activity cannot be closed: saved results
// can never be changed, so they must not be stored with the speed rule.
export const RANKERS = Object.freeze({ SPEED: rankSpeed });
