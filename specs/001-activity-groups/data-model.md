# SF-01 資料模型

對應 FR-01、AC-04、AC-08、AC-15、AC-16。活動與組別由 [共用 migration](../../src/db/migrations/000-base-schema.sql) 建立，工作階段由 [SF-01 migration](../../src/db/migrations/001-01-activity-sessions.sql) 建立。

- `activities` 有唯一 `join_code`、`status` 與 `mode`。建立時為 `PREPARING`、速度模式。加入碼為六碼指定字元；建立交易保證同時最多一場 `status <> 'CLOSED'`（AC-24，不另加 migration）。
- `student_groups` 屬於一個活動，`(activity_id, name)` 唯一，`name` 為 trim 後 1～30 個 Unicode 字元（由 `joinActivity` 檢查，AC-24）。退出僅可在 `PREPARING` 刪除已驗證的本人組別。
- `group_sessions` 以 Cookie 的摘要識別，`group_id` 唯一且設定 `ON DELETE CASCADE`。退出組別與工作階段在同一交易失效。
- `teacher_settings` 保存單一教師的 salt 及密碼雜湊；`teacher_sessions` 保存 Cookie 摘要及 `expires_at`。登入核發新 Cookie，登出撤銷工作階段。
- `group_join_secret` 保存伺服器 HMAC 種子。預備 Cookie 及工作階段 Cookie 留在瀏覽器，CSRF token 由對應 Cookie 衍生。
