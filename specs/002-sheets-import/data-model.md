# SF-02 資料模型

對應 FR-02、FR-08（匯入）及 AC-02、AC-03、AC-17。實作使用 [共用 migration](../../src/db/migrations/000-base-schema.sql) 及 [匯入服務](../../src/features/sheets-import/units.js)。

- **預覽**存於每個 router 實例的記憶體，以 UUID 為索引，含 `activityId`、教師工作階段摘要、`expiresAt` 與預覽內容。15 分鐘後失效；最多保留 100 份，確認成功時移除已使用的預覽。
- **作答單位**以 `units.id` 識別，屬於一個活動。`kind` 為 `SINGLE` 或 `GROUP`，後者具有 `group_code`。`position` 以首個成員的掃描位置決定，同活動不可重複。
- **題目**以 `questions.id` 識別，在同一活動的 `question_key` 唯一。`position` 記錄跨工作表掃描位置，`position_in_unit` 記錄單位內次序。每個答案格對應同一試算表 ID、工作表 ID 及零基底列欄位置，另保留工作表名稱與 `original_marker`。
- **確認**在 `PREPARING` 交易內刪除舊 `units`（連同其 `questions`）並寫入整份新資料。交易回滾時，舊預覽對應的已確認資料可照常讀取。學生由 SF-03 的投影取得單位與題號。
