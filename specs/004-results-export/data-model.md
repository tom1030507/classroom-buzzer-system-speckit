# SF-04 資料模型

藍圖為 [Class 圖](../../diagrams/004-results-export-class.puml)。沿用 `000-base-schema.sql` 的資料表，
新增兩個 migration：`004-01-backfill-speed-results.sql`、`004-02-sheet-exports.sql`。

## 結果 `results`（基礎模型，SF-04 擁有）

| 欄位 | 規則 |
| --- | --- |
| `submission_id` | PK，指向 `submissions`；每筆受理恰好一筆結果 |
| `unit_id` | 與受理相同的單位（複合外鍵） |
| `final_rank` | 單位內唯一，從 1 起算 |
| `is_winner` | `final_rank = 1` 時為 1，否則為 0 |

- 只在活動 `CLOSED` 時新增；之後不可修改或刪除（基礎模型的 trigger）。
- 由 `saveFinalResults` 在結束交易內一次寫入整場活動的結果；速度模式下 `final_rank` 依單位內受理序號的先後排列。
- 無人作答的單位沒有任何結果列。

## 寫回紀錄 `sheet_exports`（004-02，新增）

| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| `id` | INTEGER PK | |
| `activity_id` | TEXT NOT NULL | 指向 `activities` |
| `started_at` | TEXT NOT NULL | UTC ISO 8601 |
| `finished_at` | TEXT | 完成時填入；`RUNNING` 時為 NULL |
| `outcome` | TEXT NOT NULL | `RUNNING`、`SUCCEEDED`、`CONFLICT`、`FAILED`、`UNKNOWN` |
| `error_code` | TEXT | 整批失敗或中斷的原因，例如 `SHEETS_PERMISSION`、`INTERRUPTED` |

- 部分唯一索引：同一活動最多一筆 `outcome = 'RUNNING'`。
- 狀態轉移：`RUNNING` → `SUCCEEDED`／`CONFLICT`／`FAILED`／`UNKNOWN`，完成後不再改變。

## 逐題紀錄 `sheet_export_items`（004-02，新增）

| 欄位 | 型別 | 規則 |
| --- | --- | --- |
| `export_id` | INTEGER NOT NULL | 指向 `sheet_exports`；與 `question_id` 組成 PK |
| `question_id` | INTEGER NOT NULL | 指向 `questions`；只記錄有勝出答案的題目 |
| `spreadsheet_id`、`sheet_id`、`row_index`、`column_index` | | 本次的目標格（0-based），取自匯入時的映射 |
| `sheet_title` | TEXT NOT NULL | 寫回當下的工作表名稱（工作表已不存在時為匯入時的名稱），只供顯示 |
| `content` | TEXT NOT NULL | 要寫入的勝出答案原文 |
| `status` | TEXT NOT NULL | 見下表 |
| `reason` | TEXT | 衝突或失敗原因代碼 |

| `status` | 顯示 | 意義 |
| --- | --- | --- |
| `PENDING` | 寫入中 | 已核對可寫入，正在送出；程序中斷時改為 `UNKNOWN` |
| `WRITTEN` | 成功 | 已寫入且回讀一致 |
| `ALREADY_PRESENT` | 已是相同內容 | 寫入前格子已是同一份答案，未重寫 |
| `CONFLICT` | 衝突 | 原因：`SHEET_MISSING`、`OUT_OF_RANGE`、`MERGED`、`CHANGED`、`READBACK_MISMATCH` |
| `SKIPPED` | 未寫入 | 其他題衝突，整批停止 |
| `FAILED` | 失敗 | Google 明確拒絕，或回讀確認仍是原標記；原因為錯誤代碼 |
| `UNKNOWN` | 待核對 | 無法確定是否已寫入；下次寫回會先核對線上值 |

整批結果：全部題目都是 `WRITTEN` 或 `ALREADY_PRESENT` 才是 `SUCCEEDED`；否則依序取
`UNKNOWN`（有任一待核對）、`CONFLICT`（有任一衝突）、`FAILED`。

## 結果檢視 `ResultView`（API 回應，結果頁與 CSV 共用）

```json
{
  "activity": { "id": "…", "mode": "SPEED", "status": "CLOSED", "closedAt": "2026-11-20T08:30:00.000Z" },
  "units": [
    {
      "id": 12, "kind": "GROUP", "label": "G:A", "position": 2,
      "questions": [{ "key": "6" }, { "key": "9" }],
      "noAnswer": false,
      "entries": [
        { "groupName": "乙組", "acceptedOrder": 2, "acceptedAt": "2026-11-20T08:01:05.000Z",
          "rank": 1, "isWinner": true,
          "answers": [{ "questionKey": "6", "text": "葉綠體" }, { "questionKey": "9", "text": "二氧化碳" }] }
      ]
    }
  ]
}
```

- `units` 依單位固定順序；`questions` 依組內題序；`entries` 依最終順位。
- `label`：單題為 `Q:<題號>`，題組為 `G:<題組代號>`（Clarification）。
- `acceptedOrder` 是整場活動的受理序號 `accept_seq`（research R2）。
- 不包含組別 ID、受理識別等內部值。

## 寫回預覽與結果（API 回應）

逐題項目共用一個形狀：

| 欄位 | 說明 |
| --- | --- |
| `questionKey`、`unitLabel` | 題號與單位代號 |
| `groupName`、`content` | 勝出組與答案；無人作答時為 `null` |
| `target` | `{ sheetId, sheetTitle, cell }`，`sheetTitle` 為讀取當下的名稱（工作表不存在時為匯入時的名稱），`cell` 為 A1 格位 |
| `status`、`reason` | 預覽：`READY`、`ALREADY_PRESENT`、`CONFLICT`、`NO_ANSWER`；寫回：上表的狀態 |
| `reasonText` | `reason` 的中文說明；沒有原因時為 `null` |

## 驗證規則摘要

- 結果只在 `CLOSED` 可讀；學生只能讀自己所屬活動的結果。
- 寫回只寫有勝出答案的題目；`content` 必須與受理答案完全相同。
- 寫回紀錄不會修改 `results`、`submissions` 或 `questions`。
