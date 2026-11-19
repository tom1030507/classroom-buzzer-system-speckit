CREATE TABLE teacher_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  salt          BLOB NOT NULL,
  password_hash BLOB NOT NULL
);

CREATE TABLE teacher_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE group_sessions (
  token_hash TEXT PRIMARY KEY,
  group_id   INTEGER NOT NULL UNIQUE REFERENCES student_groups (id) ON DELETE CASCADE
);
