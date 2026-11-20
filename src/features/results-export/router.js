import { Router } from 'express';
import { requireGroupSession, requireTeacher } from '../activity-groups/sessions.js';
import { readResults } from './results.js';

/** SF-04 結果與匯出：結果檢視、寫回原 Google Sheets、CSV（contracts/http-api.md）。 */
export function createResultsExportRouter(deps) {
  const { db } = deps;
  const router = Router();
  const teacherOnly = requireTeacher(deps);
  const studentOnly = requireGroupSession(deps);
  const activityPath = '/teacher/activities/:activityId';

  router.get(`${activityPath}/results`, teacherOnly, (req, res) => {
    res.json(readResults(db, req.params.activityId));
  });

  // A group only ever reads its own activity; the session decides which one (FR-005).
  router.get('/student/results', studentOnly, (req, res) => {
    res.json(readResults(db, req.groupSession.activityId));
  });

  return router;
}
