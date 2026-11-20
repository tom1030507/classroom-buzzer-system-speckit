-- 004-02-sheet-exports.sql
-- SF-04：寫回原 Google Sheets 的紀錄（spec.md §6 Export、FR-07；specs/004-results-export/data-model.md）。
-- 每次寫回一筆 sheet_exports，逐題目標與結果記在 sheet_export_items，供查核與安全重試。

CREATE TABLE sheet_exports (
  id          INTEGER PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities (id),
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  outcome     TEXT NOT NULL CHECK (outcome IN ('RUNNING', 'SUCCEEDED', 'CONFLICT', 'FAILED', 'UNKNOWN')),
  error_code  TEXT,
  CHECK ((outcome = 'RUNNING') = (finished_at IS NULL))
);

-- 同一活動最多一筆進行中的寫回：程序內互斥之外的資料庫防線。
CREATE UNIQUE INDEX sheet_exports_one_running ON sheet_exports (activity_id) WHERE outcome = 'RUNNING';

CREATE TABLE sheet_export_items (
  export_id      INTEGER NOT NULL REFERENCES sheet_exports (id),
  question_id    INTEGER NOT NULL REFERENCES questions (id),
  spreadsheet_id TEXT NOT NULL,
  sheet_id       INTEGER NOT NULL,
  sheet_title    TEXT NOT NULL,
  row_index      INTEGER NOT NULL CHECK (row_index >= 0),
  column_index   INTEGER NOT NULL CHECK (column_index >= 0),
  content        TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (
    status IN ('PENDING', 'WRITTEN', 'ALREADY_PRESENT', 'CONFLICT', 'SKIPPED', 'FAILED', 'UNKNOWN')
  ),
  reason         TEXT,
  PRIMARY KEY (export_id, question_id)
);
