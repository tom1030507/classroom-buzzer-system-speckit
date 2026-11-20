import { withTransaction } from '../../db/transaction.js';
import { conflict } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';
import { getActivity } from '../activity-groups/activities.js';
import { confirmedImportSnapshot } from '../sheets-import/units.js';

export function transitionActivity({ db, clock }, id, target, expectedImportRevision) {
  return withTransaction(db, () => {
    const activity = getActivity(db, id);
    const opening = target === 'OPEN';
    if (activity.status !== (opening ? 'PREPARING' : 'OPEN')) {
      throw conflict('INVALID_PHASE', '目前階段無法執行該操作。');
    }
    const time = nowIso(clock);
    if (opening) {
      const { imported, importRevision } = confirmedImportSnapshot(db, id);
      if (!imported) {
        throw conflict('NO_QUESTIONS', '至少匯入一題才能開啟活動。');
      }
      if (expectedImportRevision !== undefined && expectedImportRevision !== importRevision) {
        throw conflict('IMPORT_CHANGED', '匯入內容已更新，請檢查最新的題目後再開啟搶答。');
      }
      db.prepare("UPDATE activities SET status = 'OPEN', opened_at = ? WHERE id = ?").run(time, id);
    } else {
      db.prepare("UPDATE activities SET status = 'CLOSED', closed_at = ? WHERE id = ?").run(time, id);
      // SF-04 (#14) persists results here, after CLOSED and before this transaction commits.
    }
    return { id, mode: activity.mode, status: target };
  });
}
