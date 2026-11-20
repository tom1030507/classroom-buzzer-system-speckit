# SF-03 資料模型

資料來源見[基礎 migration](../../src/db/migrations/000-base-schema.sql)、[受理識別 migration](../../src/db/migrations/003-01-submission-receipts.sql)及[受理服務](../../src/features/realtime-buzzer/submissions.js)。適用 FR-03～FR-05、FR-08 的送出部分。

- **活動 `activities`（FR-03，AC-04、AC-10、AC-15）** 由 `id` 識別，帶 `mode`、`status`、`opened_at` 和 `closed_at`。狀態依序為 `PREPARING`、`OPEN`、`CLOSED`。開啟和結束時間由伺服器寫入；開啟後，基礎 migration 的限制保護匯入的題目及單位。
- **組別、單位與題目（FR-04、FR-08，AC-08、AC-18）**。組別為 `student_groups`，由 SF-01 工作階段識別。SF-02 的 `units` 提供單題或題組，`questions.position_in_unit` 固定成員的順序。每筆作答的組別和單位都必須屬於同一活動。
- **受理 `submissions`（FR-04、FR-08，AC-05～AC-07、AC-10、AC-18）** 以內部 `id` 識別，含 `activity_id`、`unit_id`、`group_id`、`accept_seq` 與 `accepted_at`。`UNIQUE (unit_id, group_id)` 限制每組每單位一次，`UNIQUE (activity_id, accept_seq)` 保證活動內受理順序唯一，`accepted_at` 是伺服器 UTC 時間。速度模式按單位中最早的 `accept_seq` 判定暫定勝出。
- **答案 `submission_answers`（FR-04、FR-08，AC-08、AC-18）** 以 `(submission_id, question_id)` 識別；含 `unit_id` 與 `answer_text`。複合外鍵約束題目與受理必須指向同一單位。單位的成員答案與受理在同一交易提交。基礎 migration 限制兩表的插入階段，並禁止改寫或刪除已受理資料。
- **受理識別 `submission_receipts`（FR-04、FR-05，AC-07、AC-09、AC-15）** 依 `submission_id` 與受理一對一，`receipt_id` 是隨機且唯一的十六進位字串。migration 為既有受理補上識別，新受理由 SQLite trigger 在同一交易內產生。

教師監看以已受理資料建立，各單位的送出按 `accept_seq` 排序。學生快照只攜帶本組的 `id`、`unitId`、`acceptedAt` 及答案，或 `receipt: null`。教師準備中的 `imported` 與 `importRevision` 由 SF-02 已確認匯入即時計算。投影的欄位見[契約](contracts/http-sse.md)。
