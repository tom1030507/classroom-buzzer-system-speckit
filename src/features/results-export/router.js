import { Router } from 'express';
import { requireGroupSession, requireMutation, requireTeacher } from '../activity-groups/sessions.js';
import { readResults } from './results.js';
import { createSheetsExporter } from './sheets-export.js';

/** SF-04 結果與匯出：結果檢視、寫回原 Google Sheets、CSV（contracts/http-api.md）。 */
export function createResultsExportRouter(deps) {
  const { db } = deps;
  const router = Router();
  const teacherOnly = requireTeacher(deps);
  const studentOnly = requireGroupSession(deps);
  const teacherMutation = requireMutation(deps, 'teacher');
  const exporter = createSheetsExporter(deps);
  const activityPath = '/teacher/activities/:activityId';

  router.get(`${activityPath}/results`, teacherOnly, (req, res) => {
    res.json(readResults(db, req.params.activityId));
  });

  // A group only ever reads its own activity; the session decides which one (FR-005).
  router.get('/student/results', studentOnly, (req, res) => {
    res.json(readResults(db, req.groupSession.activityId));
  });

  // Write-back to the original spreadsheet (FR-07). Both POSTs reach Google, so they need
  // the teacher's Origin and CSRF checks like other mutations.
  router.post(`${activityPath}/sheets-export/preview`, teacherOnly, teacherMutation, async (req, res) => {
    res.json(await exporter.preview(req.params.activityId));
  });
  router.post(`${activityPath}/sheets-export`, teacherOnly, teacherMutation, async (req, res) => {
    res.json({ export: await exporter.run(req.params.activityId, { editsPaused: req.body?.editsPaused }) });
  });
  router.get(`${activityPath}/sheets-export`, teacherOnly, (req, res) => {
    res.json({ export: exporter.latest(req.params.activityId) });
  });

  return router;
}
