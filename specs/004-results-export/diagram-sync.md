# SF-04 圖表同步紀錄

核對日期為 2026-11-20，對照 commit `e340380` 的實作與系統基準圖。沒有偏離 plan.md 或規格的實作；
下表的 updated 都是實作時已記錄在 plan.md、research.md 或 data-model.md 的細節，同步補進圖表。

| 圖表 | 核對項目 | 程式位置 | 狀態 |
| --- | --- | --- | --- |
| Component | 教師、學生結果頁與共用結果表 | `public/teacher/results-export.js`、`public/student/results-export.js`、`public/js/results-view.js` | match |
| Component | 頁面事件也來自 SF-01（`teacher-activity`、`student-activity`） | `public/teacher/results-export.js`、`public/student/results-export.js` | updated |
| Component | 匯出器介面為 `createSheetsExporter`（`preview`、`run`、`latest`）與 `classifyTarget` | `src/features/results-export/sheets-export.js` | updated |
| Component | 使用 SF-01 `getActivity` 與 SF-02 `cellAddress`（皆為匯出的函式） | `results.js`、`sheets-export.js`、`export-records.js` | updated |
| Component | `app.js` 建立 SF-02 與 SF-04 共用的 gateway | `src/app.js` | updated |
| Component | SF-03 結束交易呼叫 `saveFinalResults`；gateway 新增 `readTargets`、`writeCells` | `src/features/realtime-buzzer/state.js`、`src/features/sheets-import/gateway.js` | match |
| Class | `results` 欄位、單位內唯一順位與不可修改 | `000-base-schema.sql`、`src/features/results-export/results.js` | match |
| Class | `sheet_exports` 的 RUNNING 與 `finished_at` CHECK、部分唯一索引 | `src/db/migrations/004-02-sheet-exports.sql` | updated |
| Class | `sheet_export_items` 保存寫回當下的 `sheet_title` | `src/db/migrations/004-02-sheet-exports.sql` | updated |
| Class | `export-records.js` 的函式（`updateItems`、`abandonRun`、`readExport`，以及帶 `clock` 的參數） | `src/features/results-export/export-records.js` | updated |
| Class | `ResultView` 含 `closedAt`，單位含 `id`、`kind`、`position` | `src/features/results-export/results.js` | updated |
| Sequence：結束、結果與 CSV | 結束交易內保存結果、兩種角色讀取結果、CSV 下載 | `state.js`、`router.js`、`results.js`、`csv.js` | match |
| Sequence：結束、結果與 CSV | CSV 回應標頭；重新整理頁面時同樣觸發載入 | `router.js`、`public/*/results-export.js` | updated |
| Sequence：寫回 | 預覽、互斥、寫入前核對、整批停止、單一批次寫入、回讀、待核對 | `sheets-export.js`、`export-records.js`、`gateway.js` | match |
| Sequence：寫回 | 核對讀取失敗的分支、衝突時已是相同內容題的紀錄、非預期錯誤的處理、重新整理時的最近紀錄 | `sheets-export.js`、`export-records.js`、`router.js` | updated |
| system-class | 「SF-04 新增」的匯出紀錄佔位改為 `sheet_exports`、`sheet_export_items` | `src/db/migrations/004-02-sheet-exports.sql` | updated |
| system-component、system-sequence | SF-04 與 SF-02 gateway 的關係、結束與寫回流程 | `src/app.js`、`src/features/results-export/` | match |

以 `npm run diagrams -- diagrams/004-results-export-*.puml diagrams/system-class.puml` 重新產生 5 張 PNG。
