import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { nowIso } from '../../lib/time.js';

const HOUR = 60 * 60 * 1000;
const TEACHER_AGE = 12 * HOUR;
const GROUP_AGE = 400 * 24 * HOUR;
const COOKIE = { teacher: 'buzzer_teacher', student: 'buzzer_group' };
const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'strict', path: '/' };
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const newToken = () => randomBytes(32).toString('base64url');
const digest = (token) => createHash('sha256').update(token).digest('hex');
const csrf = (token) => createHash('sha256').update('csrf:').update(token).digest('base64url');
const bootstrapCookie = (role) => `${COOKIE[role]}_bootstrap`;

function readCookie(req, name) {
  const entry = req.headers.cookie?.split(';').map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));
  const value = entry?.slice(name.length + 1);
  return TOKEN_PATTERN.test(value ?? '') ? value : null;
}

function teacherSession({ db, clock }, req) {
  const token = readCookie(req, COOKIE.teacher);
  if (!token) return null;
  const tokenHash = digest(token);
  return db.prepare('SELECT 1 FROM teacher_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash, nowIso(clock)) ? { token, tokenHash } : null;
}

export function getGroupSession({ db }, req) {
  const token = readCookie(req, COOKIE.student);
  return token ? findGroupSession(db, token) : null;
}

export function findGroupSession(db, token) {
  const row = db.prepare(`
    SELECT g.id AS groupId, g.name, a.id AS activityId, a.join_code AS joinCode, a.status, a.mode
    FROM group_sessions AS s JOIN student_groups AS g ON g.id = s.group_id
    JOIN activities AS a ON a.id = g.activity_id WHERE s.token_hash = ?
  `).get(digest(token));
  return row ? { token, ...row } : null;
}

export function requireTeacher(deps) {
  return (req, res, next) => {
    req.teacherSession = teacherSession(deps, req);
    if (!req.teacherSession) throw unauthorized('TEACHER_REQUIRED', '請先登入教師帳號。');
    next();
  };
}

export function requireGroupSession(deps) {
  return (req, res, next) => {
    req.groupSession = getGroupSession(deps, req);
    if (!req.groupSession) throw unauthorized('GROUP_REQUIRED', '請先加入活動。');
    next();
  };
}

function sameOrigin(req) {
  try {
    const origin = new URL(req.headers.origin);
    const expected = new URL(`http://${req.headers.host}`);
    return LOCAL_HOSTS.has(expected.hostname) && Number(expected.port || 80) === req.socket.localPort &&
      req.headers.origin === origin.origin && origin.origin === expected.origin;
  } catch {
    return false;
  }
}

export function requireMutation(deps, role) {
  return (req, res, next) => {
    if (!sameOrigin(req)) throw forbidden('INVALID_ORIGIN', '請從本機系統頁面操作。');
    const session = role === 'teacher' ? teacherSession(deps, req) : getGroupSession(deps, req);
    const cookie = session?.token ?? readCookie(req, bootstrapCookie(role));
    const token = req.get('X-CSRF-Token') ?? '';
    if (!cookie || !TOKEN_PATTERN.test(token) || !timingSafeEqual(Buffer.from(csrf(cookie)), Buffer.from(token))) {
      throw forbidden('INVALID_CSRF', '安全驗證已失效，請重新整理頁面。');
    }
    req.mutationToken = cookie;
    next();
  };
}

function bootstrap(req, res, role) {
  const cookieName = bootstrapCookie(role);
  const existing = readCookie(req, cookieName);
  return existing ? csrf(existing) : issueBootstrap(res, role);
}

function issueBootstrap(res, role) {
  const token = newToken();
  res.cookie(bootstrapCookie(role), token, { ...COOKIE_OPTIONS, maxAge: HOUR });
  return csrf(token);
}

export function readTeacherSession(deps, req, res) {
  const session = teacherSession(deps, req);
  return { authenticated: !!session, csrfToken: session ? csrf(session.token) : bootstrap(req, res, 'teacher') };
}

export function readStudentSession(deps, req, res) {
  const session = getGroupSession(deps, req);
  if (!session) return { group: null, activity: null, csrfToken: bootstrap(req, res, 'student') };
  return studentView(session, session.token);
}

export function startTeacherSession({ db, clock }, req, res) {
  const oldSession = teacherSession({ db, clock }, req);
  if (oldSession) db.prepare('DELETE FROM teacher_sessions WHERE token_hash = ?').run(oldSession.tokenHash);
  const now = clock.now();
  db.prepare('DELETE FROM teacher_sessions WHERE expires_at <= ?').run(now.toISOString());
  const token = newToken();
  db.prepare('INSERT INTO teacher_sessions (token_hash, expires_at) VALUES (?, ?)')
    .run(digest(token), new Date(now.getTime() + TEACHER_AGE).toISOString());
  setSessionCookie(res, 'teacher', token, TEACHER_AGE);
  return { authenticated: true, csrfToken: csrf(token) };
}

export function endTeacherSession({ db }, req, res) {
  db.prepare('DELETE FROM teacher_sessions WHERE token_hash = ?').run(req.teacherSession.tokenHash);
  res.clearCookie(COOKIE.teacher, COOKIE_OPTIONS);
  return { authenticated: false, csrfToken: bootstrap(req, res, 'teacher') };
}

export function groupJoinToken(db, previousToken) {
  const { secret } = db.prepare('SELECT secret FROM group_join_secret WHERE id = 1').get();
  return createHmac('sha256', secret).update(previousToken).digest('base64url');
}

export function insertGroupSession(db, groupId, token) {
  db.prepare('INSERT INTO group_sessions (token_hash, group_id) VALUES (?, ?)').run(digest(token), groupId);
  return token;
}

export function respondToLeave(res) {
  res.clearCookie(COOKIE.student, COOKIE_OPTIONS);
  return { group: null, activity: null, csrfToken: issueBootstrap(res, 'student') };
}

export function respondToJoin(res, session) {
  setSessionCookie(res, 'student', session.token, GROUP_AGE);
  return studentView(session, session.token);
}

function setSessionCookie(res, role, token, maxAge) {
  res.cookie(COOKIE[role], token, { ...COOKIE_OPTIONS, maxAge });
  res.clearCookie(bootstrapCookie(role), COOKIE_OPTIONS);
}

function studentView({ name, activityId, status, mode }, token) {
  return { group: { name }, activity: { id: activityId, status, mode }, csrfToken: csrf(token) };
}
