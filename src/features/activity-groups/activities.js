import { randomBytes, randomUUID } from 'node:crypto';
import { withTransaction } from '../../db/transaction.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';
import { findGroupSession, getGroupSession, groupJoinToken, insertGroupSession } from './sessions.js';

const ACTIVITY_FIELDS = 'id, join_code AS joinCode, status, mode, created_at AS createdAt';

export function getActivity(db, id) {
  const row = db.prepare(`SELECT ${ACTIVITY_FIELDS} FROM activities WHERE id = ?`).get(id);
  if (!row) throw notFound('ACTIVITY_NOT_FOUND', '找不到活動。');
  return row;
}

export function listAvailableActivities(db) {
  return db.prepare(`
    SELECT ${ACTIVITY_FIELDS} FROM activities
    WHERE status <> 'CLOSED' OR rowid = (SELECT MAX(rowid) FROM activities)
    ORDER BY rowid DESC
  `).all();
}

export function listGroups(db, activityId) {
  return db.prepare('SELECT id, name FROM student_groups WHERE activity_id = ? ORDER BY id').all(activityId);
}

export function createActivity({ db, clock }) {
  const id = randomUUID();
  const insert = db.prepare('INSERT INTO activities (id, join_code, created_at) VALUES (?, ?, ?) ON CONFLICT (join_code) DO NOTHING');
  let created;
  do {
    const joinCode = randomBytes(5).toString('hex').toUpperCase();
    created = insert.run(id, joinCode, nowIso(clock));
  } while (!created.changes);
  return getActivity(db, id);
}

export function joinActivity(deps, req) {
  const { db, clock } = deps;
  const body = req.body ?? {};
  const joinCode = typeof body.joinCode === 'string' ? body.joinCode.trim().toUpperCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (Object.keys(body).some((key) => key !== 'name' && key !== 'joinCode') ||
      !/^[A-Z0-9]{1,32}$/.test(joinCode) || !name || !name.isWellFormed() || [...name].length > 100 || /[\p{Cc}]/u.test(name)) {
    throw badRequest('INVALID_JOIN', '請輸入有效的加入碼與組名（最多 100 個字元）。');
  }

  return withTransaction(db, () => {
    const existing = getGroupSession(deps, req);
    if (existing && existing.status !== 'CLOSED') {
      throw conflict('ALREADY_JOINED', '你已加入一場進行中的活動。');
    }
    const token = groupJoinToken(db, req.mutationToken);
    const previousJoin = findGroupSession(db, token);
    if (previousJoin) {
      if (previousJoin.name === name && previousJoin.joinCode === joinCode) return previousJoin;
      throw conflict('ALREADY_JOINED', '這個工作階段已加入一場活動，請重新載入頁面。');
    }
    const activity = db.prepare('SELECT id, status, mode FROM activities WHERE join_code = ?').get(joinCode);
    if (!activity) throw notFound('INVALID_JOIN_CODE', '找不到這個加入碼。');
    if (activity.status !== 'PREPARING') throw conflict('INVALID_PHASE', '這場活動已停止接受新組別。');
    const group = db.prepare(`
      INSERT INTO student_groups (activity_id, name, created_at) VALUES (?, ?, ?)
      ON CONFLICT (activity_id, name) DO NOTHING RETURNING id
    `).get(activity.id, name, nowIso(clock));
    if (!group) throw conflict('JOIN_REJECTED', '無法使用這個組名加入，請輸入其他組名。');
    insertGroupSession(db, group.id, token);
    return { token, groupId: group.id, name, activityId: activity.id, status: activity.status, mode: activity.mode };
  });
}
