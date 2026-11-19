import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { configureTeacher, teacherConfigured } from '../src/features/activity-groups/password.js';

async function readPassword() {
  const output = new Writable({ write(chunk, encoding, done) { done(); } });
  const input = createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
  process.stdout.write('設定教師密碼（至少 8 個字元）：');
  try {
    for await (const line of input) return line;
  } finally {
    input.close();
    console.log();
  }
  throw new Error('未輸入教師密碼。');
}

try {
  const config = loadConfig();
  if (config.databaseFile === ':memory:') throw new Error('請指定持久化資料庫再設定密碼。');
  const db = openDatabase(config.databaseFile);
  try {
    migrate(db);
    const created = !teacherConfigured(db) && await configureTeacher(db, await readPassword());
    console.log(created ? '已設定教師密碼。' : '教師密碼已設定。');
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
