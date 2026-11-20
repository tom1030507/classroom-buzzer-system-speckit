import { Router } from 'express';
import { requireMutation, requireTeacher } from '../activity-groups/sessions.js';
import { selectMode } from './modes.js';

/** The body must be exactly `{ mode }`; anything else counts as "no mode" and is refused as INVALID_MODE. */
function requestedMode(body) {
  const isObject = body !== null && typeof body === 'object' && !Array.isArray(body);
  return isObject && Object.keys(body).length === 1 ? body.mode : undefined;
}

/** SF-05 公平排序：準備中選擇活動模式（contracts/http-api.md）。 */
export function createFairRankingRouter(deps) {
  const router = Router();
  const teacherOnly = requireTeacher(deps);
  const teacherMutation = requireMutation(deps, 'teacher');

  // Mounted after the app's global JSON parser, so req.body is already parsed here.
  router.post('/teacher/activities/:activityId/mode', teacherOnly, teacherMutation, (req, res) => {
    res.json({ activity: selectMode(deps, req.params.activityId, requestedMode(req.body)) });
  });

  return router;
}
