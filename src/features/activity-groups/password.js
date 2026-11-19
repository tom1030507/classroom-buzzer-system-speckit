import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError, unauthorized } from '../../lib/errors.js';

const derive = promisify(scrypt);

export function teacherConfigured(db) {
  return Boolean(db.prepare('SELECT id FROM teacher_settings WHERE id = 1').get());
}

export async function configureTeacher(db, password) {
  if (password.length < 8 || Buffer.byteLength(password) > 1024) {
    throw new Error('教師密碼須至少 8 個字元，且不得超過 1024 位元組。');
  }
  const salt = randomBytes(16);
  const hash = await derive(password, salt, 64);
  return db.prepare('INSERT OR IGNORE INTO teacher_settings (id, salt, password_hash) VALUES (1, ?, ?)')
    .run(salt, hash).changes === 1;
}

export async function verifyTeacherPassword(db, password) {
  const settings = db.prepare('SELECT salt, password_hash FROM teacher_settings WHERE id = 1').get();
  if (!settings) {
    throw new AppError(503, 'TEACHER_SETUP_REQUIRED', '請在伺服器終端機執行 npm run setup:teacher，設定教師密碼。');
  }
  if (typeof password === 'string' && Buffer.byteLength(password) <= 1024) {
    const candidate = await derive(password, settings.salt, settings.password_hash.length);
    if (timingSafeEqual(candidate, settings.password_hash)) return;
  }
  throw unauthorized('INVALID_CREDENTIALS', '教師密碼不正確。');
}
