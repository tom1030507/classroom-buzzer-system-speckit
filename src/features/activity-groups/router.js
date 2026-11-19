import { Router } from 'express';
import { createActivity, getActivity, getLatestActivity, joinActivity, listGroups } from './activities.js';
import { teacherConfigured, verifyTeacherPassword } from './password.js';
import {
  endTeacherSession, readStudentSession, readTeacherSession, requireMutation,
  requireTeacher, respondToJoin, startTeacherSession,
} from './sessions.js';

export function createActivityGroupsRouter(deps) {
  const { db } = deps;
  const router = Router();
  const teacherOnly = requireTeacher(deps);
  const teacherMutation = requireMutation(deps, 'teacher');
  const studentMutation = requireMutation(deps, 'student');

  router.get('/teacher/session', (req, res) => {
    res.json({ ...readTeacherSession(deps, req, res), setupRequired: !teacherConfigured(db) });
  });
  router.post('/teacher/login', teacherMutation, async (req, res) => {
    await verifyTeacherPassword(db, req.body?.password);
    res.json(startTeacherSession(deps, req, res));
  });
  router.post('/teacher/logout', teacherOnly, teacherMutation, (req, res) => {
    res.json(endTeacherSession(deps, req, res));
  });
  router.post('/teacher/activities', teacherOnly, teacherMutation, (req, res) => {
    res.status(201).json({ activity: createActivity(deps), groups: [] });
  });
  router.get('/teacher/activities/current', teacherOnly, (req, res) => {
    const activity = getLatestActivity(db);
    res.json({ activity, groups: activity ? listGroups(db, activity.id) : [] });
  });
  router.get('/teacher/activities/:activityId', teacherOnly, (req, res) => {
    const activity = getActivity(db, req.params.activityId);
    res.json({ activity, groups: listGroups(db, activity.id) });
  });
  router.get('/student/session', (req, res) => res.json(readStudentSession(deps, req, res)));
  router.post('/student/join', studentMutation, (req, res) => {
    res.status(201).json(respondToJoin(res, joinActivity(deps, req)));
  });
  return router;
}
