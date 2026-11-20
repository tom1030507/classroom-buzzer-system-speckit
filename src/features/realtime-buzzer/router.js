import { json, Router } from 'express';
import { badRequest, unauthorized } from '../../lib/errors.js';
import {
  getGroupSession, getTeacherSession, requireGroupSession, requireMutation, requireTeacher,
} from '../activity-groups/sessions.js';
import { streamSnapshots } from './events.js';
import { studentSnapshot, teacherSnapshot } from './snapshots.js';
import { transitionActivity } from './state.js';
import { acceptSubmission, submissionBodyLimit } from './submissions.js';

export function createRealtimeBuzzerRouter(deps) {
  const { db } = deps;
  const router = Router();
  const teacherOnly = requireTeacher(deps);
  const studentOnly = requireGroupSession(deps);
  const teacherMutation = requireMutation(deps, 'teacher');
  const studentMutation = requireMutation(deps, 'student');
  const activityPath = '/teacher/activities/:activityId';
  const controlBody = json({ limit: '8kb' });

  function parseSubmission(req, res, next) {
    if (req.groupSession.status !== 'OPEN') return next();
    const limit = submissionBodyLimit(db, req.groupSession.activityId, req.params.unitId);
    json({ limit })(req, res, next);
  }

  router.get(`${activityPath}/live`, teacherOnly, (req, res) => {
    res.json(teacherSnapshot(db, req.params.activityId));
  });
  router.get(`${activityPath}/events`, teacherOnly, (req, res) => {
    streamSnapshots(res, () => {
      if (!getTeacherSession(deps, req)) throw unauthorized('TEACHER_REQUIRED', '請先登入教師帳號。');
      return teacherSnapshot(db, req.params.activityId);
    });
  });
  router.post(`${activityPath}/open`, teacherOnly, teacherMutation, controlBody, (req, res) => {
    res.json({ activity: transitionActivity(deps, req.params.activityId, 'OPEN', req.body?.importRevision) });
  });
  router.post(`${activityPath}/close`, teacherOnly, teacherMutation, controlBody, (req, res) => {
    if (req.body?.confirm !== true) {
      throw badRequest('CLOSE_CONFIRMATION_REQUIRED', '請確認要結束這場活動。');
    }
    res.json({ activity: transitionActivity(deps, req.params.activityId, 'CLOSED') });
  });

  router.get('/student/activity', studentOnly, (req, res) => {
    res.json(studentSnapshot(db, req.groupSession));
  });
  router.get('/student/events', studentOnly, (req, res) => {
    streamSnapshots(res, () => {
      const session = getGroupSession(deps, req);
      if (!session) throw unauthorized('GROUP_REQUIRED', '請先加入活動。');
      return studentSnapshot(db, session);
    });
  });
  router.post('/student/units/:unitId/submissions', studentOnly, studentMutation, parseSubmission, (req, res) => {
    const { created, receipt } = acceptSubmission(deps, req);
    res.status(created ? 201 : 200).json({ receipt });
  });
  return router;
}
