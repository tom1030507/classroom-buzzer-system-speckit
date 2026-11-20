import { withTransaction } from '../../db/transaction.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { getActivity } from '../activity-groups/activities.js';

export const MODES = Object.freeze(['SPEED', 'FAIR']);

/**
 * Chooses the activity mode (FR-007, spec.md §4). Only a PREPARING activity can change, and
 * choosing the current mode again is fine; every request after the activity opens is refused,
 * even for the same mode. The check and the update share one transaction with opening and
 * closing, so a change and an open at the same moment have exactly one outcome (AC-23). The
 * activities_mode_locked_after_open trigger is the last line of defense.
 *
 * @returns the updated activity ({ id, joinCode, status, mode, createdAt })
 */
export function selectMode({ db }, activityId, mode) {
  if (!MODES.includes(mode)) throw badRequest('INVALID_MODE', '請選擇速度模式或公平模式。');
  return withTransaction(db, () => {
    const activity = getActivity(db, activityId);
    if (activity.status !== 'PREPARING') {
      throw conflict('INVALID_PHASE', '活動開啟後模式已鎖定，無法更改。');
    }
    db.prepare('UPDATE activities SET mode = ? WHERE id = ?').run(mode, activityId);
    return getActivity(db, activityId);
  });
}
