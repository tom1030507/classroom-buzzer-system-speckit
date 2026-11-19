-- 000-base-schema.sql
-- 共用基礎資料模型，對應 spec.md §6「最小資料模型」。
-- 此檔合併進 main 後不得修改；各子功能以新的 migration 擴充（見同目錄 README.md）。
-- 工作階段與教師設定（SF-01）、匯出紀錄 Export（SF-04）由負責的子功能以自己的 migration 新增。
-- 時間欄位一律為 UTC ISO 8601 字串，例如 2026-11-19T08:00:00.000Z。
-- 下列 trigger 是資料庫層的最後防線；應用程式仍須先行驗證並回傳明確的錯誤代碼。

-- ---------------------------------------------------------------------------
-- Activity：活動 ID、加入碼、模式、狀態、建立／開始／結束時間
-- ---------------------------------------------------------------------------
CREATE TABLE activities (
  id         TEXT PRIMARY KEY,
  join_code  TEXT NOT NULL UNIQUE,
  mode       TEXT NOT NULL DEFAULT 'SPEED' CHECK (mode IN ('SPEED', 'FAIR')),
  status     TEXT NOT NULL DEFAULT 'PREPARING' CHECK (status IN ('PREPARING', 'OPEN', 'CLOSED')),
  created_at TEXT NOT NULL,
  opened_at  TEXT,
  closed_at  TEXT,
  CHECK (
    (status = 'PREPARING' AND opened_at IS NULL AND closed_at IS NULL)
    OR (status = 'OPEN' AND opened_at IS NOT NULL AND closed_at IS NULL)
    OR (status = 'CLOSED' AND opened_at IS NOT NULL AND closed_at IS NOT NULL)
  )
);

-- spec.md §3：唯一轉移為 PREPARING → OPEN → CLOSED
CREATE TRIGGER activities_status_forward_only
BEFORE UPDATE OF status ON activities
WHEN NOT (
  NEW.status = OLD.status
  OR (OLD.status = 'PREPARING' AND NEW.status = 'OPEN')
  OR (OLD.status = 'OPEN' AND NEW.status = 'CLOSED')
)
BEGIN
  SELECT RAISE(ABORT, 'activity status can only move PREPARING -> OPEN -> CLOSED');
END;

-- spec.md §3、§4：開啟後鎖定模式
CREATE TRIGGER activities_mode_locked_after_open
BEFORE UPDATE OF mode ON activities
WHEN OLD.status <> 'PREPARING' AND NEW.mode IS NOT OLD.mode
BEGIN
  SELECT RAISE(ABORT, 'activity mode is locked once the activity is OPEN');
END;

-- ---------------------------------------------------------------------------
-- Group：活動、組別 ID、名稱；活動內名稱唯一（工作階段資訊由 SF-01 擴充）
-- ---------------------------------------------------------------------------
CREATE TABLE student_groups (
  id          INTEGER PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) > 0),
  created_at  TEXT NOT NULL,
  UNIQUE (activity_id, name),
  UNIQUE (activity_id, id)
);

-- spec.md §2、FR-01：僅準備中可新增組別
CREATE TRIGGER student_groups_join_only_while_preparing
BEFORE INSERT ON student_groups
WHEN (SELECT status FROM activities WHERE id = NEW.activity_id) IS NOT 'PREPARING'
BEGIN
  SELECT RAISE(ABORT, 'groups can join only while the activity is PREPARING');
END;

-- ---------------------------------------------------------------------------
-- Unit：活動、單位 ID、單題／題組類型、固定順序（成員題目見 questions）
-- ---------------------------------------------------------------------------
CREATE TABLE units (
  id          INTEGER PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('SINGLE', 'GROUP')),
  group_code  TEXT,
  position    INTEGER NOT NULL CHECK (position >= 1),
  CHECK (
    (kind = 'SINGLE' AND group_code IS NULL)
    OR (kind = 'GROUP' AND group_code IS NOT NULL AND length(group_code) > 0)
  ),
  UNIQUE (activity_id, position),
  UNIQUE (activity_id, group_code),
  UNIQUE (activity_id, id)
);

-- ---------------------------------------------------------------------------
-- Question：單位、原題號、順序、試算表與工作表 ID、答案位置、原標記；活動內題號唯一
-- row_index／column_index 為 0-based 格位；sheet_title 為匯入當下的名稱，寫回前須以 sheet_id 重新確認。
-- ---------------------------------------------------------------------------
CREATE TABLE questions (
  id               INTEGER PRIMARY KEY,
  activity_id      TEXT NOT NULL,
  unit_id          INTEGER NOT NULL,
  question_key     TEXT NOT NULL CHECK (length(question_key) > 0),
  position         INTEGER NOT NULL CHECK (position >= 1),
  position_in_unit INTEGER NOT NULL CHECK (position_in_unit >= 1),
  spreadsheet_id   TEXT NOT NULL,
  sheet_id         INTEGER NOT NULL,
  sheet_title      TEXT NOT NULL,
  row_index        INTEGER NOT NULL CHECK (row_index >= 0),
  column_index     INTEGER NOT NULL CHECK (column_index >= 0),
  original_marker  TEXT NOT NULL,
  FOREIGN KEY (activity_id, unit_id) REFERENCES units (activity_id, id) ON DELETE CASCADE,
  UNIQUE (activity_id, question_key),
  UNIQUE (activity_id, position),
  UNIQUE (unit_id, position_in_unit),
  UNIQUE (activity_id, spreadsheet_id, sheet_id, row_index, column_index),
  UNIQUE (unit_id, id)
);

-- spec.md §3：開啟後鎖定題目與單位順序
CREATE TRIGGER units_locked_insert
BEFORE INSERT ON units
WHEN (SELECT status FROM activities WHERE id = NEW.activity_id) IS NOT 'PREPARING'
BEGIN
  SELECT RAISE(ABORT, 'units are locked once the activity is OPEN');
END;

CREATE TRIGGER units_locked_update
BEFORE UPDATE ON units
WHEN (SELECT status FROM activities WHERE id = OLD.activity_id) IS NOT 'PREPARING'
BEGIN
  SELECT RAISE(ABORT, 'units are locked once the activity is OPEN');
END;

CREATE TRIGGER units_locked_delete
BEFORE DELETE ON units
WHEN (SELECT status FROM activities WHERE id = OLD.activity_id) IS NOT 'PREPARING'
BEGIN
  SELECT RAISE(ABORT, 'units are locked once the activity is OPEN');
END;

CREATE TRIGGER questions_locked_insert
BEFORE INSERT ON questions
WHEN (SELECT status FROM activities WHERE id = NEW.activity_id) IS NOT 'PREPARING'
BEGIN
  SELECT RAISE(ABORT, 'questions are locked once the activity is OPEN');
END;

CREATE TRIGGER questions_locked_update
BEFORE UPDATE ON questions
WHEN (SELECT status FROM activities WHERE id = OLD.activity_id) IS NOT 'PREPARING'
BEGIN
  SELECT RAISE(ABORT, 'questions are locked once the activity is OPEN');
END;

CREATE TRIGGER questions_locked_delete
BEFORE DELETE ON questions
WHEN (SELECT status FROM activities WHERE id = OLD.activity_id) IS NOT 'PREPARING'
BEGIN
  SELECT RAISE(ABORT, 'questions are locked once the activity is OPEN');
END;

-- ---------------------------------------------------------------------------
-- Submission：活動、單位、組別、受理時間與序號；單位與組別組合唯一（各題答案見 submission_answers）
-- 複合外鍵確保單位與組別屬於同一活動。
-- ---------------------------------------------------------------------------
CREATE TABLE submissions (
  id          INTEGER PRIMARY KEY,
  activity_id TEXT NOT NULL,
  unit_id     INTEGER NOT NULL,
  group_id    INTEGER NOT NULL,
  accept_seq  INTEGER NOT NULL CHECK (accept_seq >= 1),
  accepted_at TEXT NOT NULL,
  FOREIGN KEY (activity_id, unit_id) REFERENCES units (activity_id, id),
  FOREIGN KEY (activity_id, group_id) REFERENCES student_groups (activity_id, id),
  UNIQUE (unit_id, group_id),
  UNIQUE (activity_id, accept_seq),
  UNIQUE (id, unit_id)
);

-- spec.md §3、FR-04：僅 OPEN 接受送出；受理後不可修改或刪除
CREATE TRIGGER submissions_only_while_open
BEFORE INSERT ON submissions
WHEN (SELECT status FROM activities WHERE id = NEW.activity_id) IS NOT 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'submissions are accepted only while the activity is OPEN');
END;

CREATE TRIGGER submissions_immutable_update
BEFORE UPDATE ON submissions
BEGIN
  SELECT RAISE(ABORT, 'accepted submissions cannot be modified');
END;

CREATE TRIGGER submissions_immutable_delete
BEFORE DELETE ON submissions
BEGIN
  SELECT RAISE(ABORT, 'accepted submissions cannot be deleted');
END;

-- 各題答案：原文含換行完整保存；空白與長度規則由 SF-03 驗證。
-- 複合外鍵確保答案的題目屬於送出的單位（FR-08：不可繞過題組單獨送題）。
CREATE TABLE submission_answers (
  submission_id INTEGER NOT NULL,
  unit_id       INTEGER NOT NULL,
  question_id   INTEGER NOT NULL,
  answer_text   TEXT NOT NULL,
  PRIMARY KEY (submission_id, question_id),
  FOREIGN KEY (submission_id, unit_id) REFERENCES submissions (id, unit_id),
  FOREIGN KEY (unit_id, question_id) REFERENCES questions (unit_id, id)
);

CREATE TRIGGER submission_answers_only_while_open
BEFORE INSERT ON submission_answers
WHEN (
  SELECT a.status
  FROM submissions AS s
  JOIN activities AS a ON a.id = s.activity_id
  WHERE s.id = NEW.submission_id
) IS NOT 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'answers are accepted only while the activity is OPEN');
END;

CREATE TRIGGER submission_answers_immutable_update
BEFORE UPDATE ON submission_answers
BEGIN
  SELECT RAISE(ABORT, 'accepted answers cannot be modified');
END;

CREATE TRIGGER submission_answers_immutable_delete
BEFORE DELETE ON submission_answers
BEGIN
  SELECT RAISE(ABORT, 'accepted answers cannot be deleted');
END;

-- ---------------------------------------------------------------------------
-- Result：單位、送出 ID、最終順位、是否勝出；與結束狀態原子保存（spec.md §4）
-- 實際受理順序保存在 submissions.accept_seq，最終順位另存於此。
-- ---------------------------------------------------------------------------
CREATE TABLE results (
  submission_id INTEGER PRIMARY KEY,
  unit_id       INTEGER NOT NULL,
  final_rank    INTEGER NOT NULL CHECK (final_rank >= 1),
  is_winner     INTEGER NOT NULL CHECK (is_winner IN (0, 1) AND is_winner = (final_rank = 1)),
  FOREIGN KEY (submission_id, unit_id) REFERENCES submissions (id, unit_id),
  UNIQUE (unit_id, final_rank)
);

CREATE TRIGGER results_only_when_closed
BEFORE INSERT ON results
WHEN (
  SELECT a.status
  FROM submissions AS s
  JOIN activities AS a ON a.id = s.activity_id
  WHERE s.id = NEW.submission_id
) IS NOT 'CLOSED'
BEGIN
  SELECT RAISE(ABORT, 'final results can be stored only when the activity is CLOSED');
END;

CREATE TRIGGER results_immutable_update
BEFORE UPDATE ON results
BEGIN
  SELECT RAISE(ABORT, 'final results cannot be modified');
END;

CREATE TRIGGER results_immutable_delete
BEFORE DELETE ON results
BEGIN
  SELECT RAISE(ABORT, 'final results cannot be deleted');
END;
