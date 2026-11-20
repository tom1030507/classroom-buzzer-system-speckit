import { getActivity, listGroups } from '../activity-groups/activities.js';
import { confirmedImportSnapshot, listQuestionUnits } from '../sheets-import/units.js';
import { listOwnReceipts, listSubmissions } from './submissions.js';

function publicUnits(db, activityId) {
  return listQuestionUnits(db, activityId).map(({ id, kind, questions }) => ({
    id, kind, questions: questions.map(({ key }) => ({ key })),
  }));
}

export function studentSnapshot(db, session) {
  const { activityId, mode, status } = session;
  const receipts = listOwnReceipts(db, session);
  return {
    activity: { id: activityId, mode, status },
    units: publicUnits(db, activityId).map((unit) => ({ ...unit, receipt: receipts.get(unit.id) ?? null })),
  };
}

export function teacherSnapshot(db, activityId) {
  const { id, status, mode } = getActivity(db, activityId);
  const groups = listGroups(db, id);
  const units = publicUnits(db, id).map((unit) => ({ ...unit, submissions: [], winnerGroupId: null }));
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  for (const submission of listSubmissions(db, id)) {
    byId.get(submission.unitId)?.submissions.push(submission);
  }
  if (mode === 'SPEED' && status === 'OPEN') {
    for (const unit of units) unit.winnerGroupId = unit.submissions[0]?.groupId ?? null;
  }
  const importState = status === 'PREPARING'
    ? confirmedImportSnapshot(db, id)
    : { imported: null, importRevision: null };
  return { activity: { id, status, mode }, groups, units, ...importState };
}
