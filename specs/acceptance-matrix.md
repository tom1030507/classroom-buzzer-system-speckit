# 驗收對照表（AC-01～AC-24）

整合驗收 [#20](https://github.com/tom1030507/classroom-buzzer-system-speckit/issues/20)。情境與通過條件以根目錄
[`spec.md`](../spec.md) §8 為準。

- **自動化測試**：`npm test`，2026-11-28 在 `main` 提交 `3e752e7` 共 173 項通過；各情境引用的案例名稱列在本頁下方。
- **線上執行**：2026-11-28 由 AI 代理（Claude Code）以瀏覽器自動化連接真實 Google Sheets，62 項檢查全部通過
  （[逐項結果](acceptance-e2e-2026-11-28.json)）。使用本組自製測試表，斷網以故障注入模擬，細節與限制見
  [SF-04 驗收紀錄](004-results-export/acceptance.md#真實線上試算表驗收)。
- **人工證據**：組員實際操作或開啟檔案後留下的紀錄與截圖。

## 對照表

| 情境 | 內容 | 線上執行（自動化） | 人工證據 |
| --- | --- | --- | --- |
| AC-01 | 真實 Sheets 匯入五題 | 通過：表1 匯入 6 題，題號與格位一致 | [SF-02 以課程範本副本匯入](002-sheets-import/acceptance.md#真實線上試算表驗收)（tom1030507，11/20）；[人工速度場](004-results-export/acceptance.md#人工操作速度模式2026-11-28) |
| AC-02 | 另一版面與不連續題號 | 通過：表3 匯入並寫回新位置 | [表3 寫回後](004-results-export/evidence/live-sheet-moved.png)；匯入見 [SF-02](002-sheets-import/acceptance.md#真實線上試算表驗收) |
| AC-03 | 零題、重複或非法標記、合併格、無權限、斷網 | 本次未重做 | [SF-02 真實試算表](002-sheets-import/acceptance.md#ac-03-錯誤回報及既有資料保留)（tom1030507，11/20） |
| AC-04 | 準備中可加入不可送出，開啟後拒絕新組，2 秒同步 | 通過：開啟後 160 毫秒同步，新組被拒絕 | — |
| AC-05 | 速度模式各題分別勝出 | 通過 | [人工速度場](004-results-export/acceptance.md#人工操作速度模式2026-11-28) |
| AC-06 | 並行同題、同時間戳 | 僅自動化測試 | — |
| AC-07 | 雙擊、重試、改答案重送 | 通過：改答案重送仍是第一筆 | — |
| AC-08 | 空白、超長、無效單位、冒用他組 | 僅自動化測試 | — |
| AC-09 | 搶答中學生看不到他組資訊 | 通過：學生畫面與 API（事件串流見自動化測試） | — |
| AC-10 | 結束與送出並行 | 僅自動化測試 | — |
| AC-11 | 固定完整結果、無人作答明示 | 通過（禁止修改見自動化測試） | [人工速度場](004-results-export/acceptance.md#人工操作速度模式2026-11-28) |
| AC-12 | 寫回中文、換行、`=` 開頭為純文字 | 通過：API 逐格讀回 | 表1 寫回後：[學習單](004-results-export/evidence/live-sheet-speed.png)、[跨表驗收](004-results-export/evidence/live-sheet-speed-page2.png) |
| AC-13 | 移動、刪除、改寫格位時停止 | 通過：五種變更與預覽後改寫 | — |
| AC-14 | 失敗、逾時後重試與重複匯出 | 通過：故障注入 | — |
| AC-15 | 刷新、重連、伺服器重啟 | 通過：重新整理與結束後重啟（搶答中重啟見自動化測試） | — |
| AC-16 | 學生呼叫教師操作、答案含腳本 | 通過：腳本只顯示為文字（授權見自動化測試） | — |
| AC-17 | 兩單題與三題題組分散寫回 | 通過 | [表1](004-results-export/evidence/live-sheet-speed.png)、[表2](005-fair-ranking/evidence/live-sheet-fair.png) |
| AC-18 | 題組缺題、拆送、並行重試、交易失敗 | 僅自動化測試 | — |
| AC-19 | CSV 編碼、欄位、轉義、排序 | 通過（[下載的 CSV](004-results-export/evidence/live-speed.csv)；學生不可下載見自動化測試） | [以 Excel 開啟](004-results-export/evidence/live-csv-excel.png)；[人工速度場下載的 CSV](004-results-export/evidence/live-manual-speed.csv) |
| AC-20 | CSV 公式防護 | CSV 內容通過 | [以 Excel 開啟](004-results-export/evidence/live-csv-excel.png) |
| AC-21 | 公平模式勝出較少者優先 | 通過 | — |
| AC-22 | 同次數、題組、無人作答、重啟 | 通過（題組只計一次見自動化測試） | — |
| AC-23 | 準備中切換、開啟後鎖定、三處一致 | 通過 | [表2 寫回後](005-fair-ranking/evidence/live-sheet-fair.png) |
| AC-24 | 活動數量、加入碼、組名 | 通過：加入碼與單一未結束活動（組名規則見自動化測試） | — |

效能基準（spec.md §7：1 位老師、10 組、20 題、2 秒內）由 AC-04 的 10 組自動化測試涵蓋；線上執行（2 組、6 題）
開啟後 160 毫秒同步，結束後 109 毫秒顯示結果。

## 尚未完成

- spec.md §8 的人工端到端驗收只完成一部分：速度模式由 45678XYZ 以自製測試表人工操作到下載 CSV
  （[紀錄](004-results-export/acceptance.md#人工操作速度模式2026-11-28)），沒有人工寫回。公平模式、衝突與重試
  情境尚未人工操作，也沒有使用課程單題範本與混合題組範本副本。自動化的線上執行不能取代人工操作。

## 自動化測試名稱

名稱引用各情境的案例（同一案例可能涵蓋多個情境）。

### AC-01

- `tests/unit/sheets-import/gateway.test.js`：AC-01 request contract signs a scoped assertion and reads selected grids and merge ranges in teacher order

### AC-02

- `tests/unit/sheets-import/parser.test.js`：AC-02 and AC-17 preserve teacher sheet order, row-major positions and groups across sheets

### AC-03

- `tests/integration/sheets-import/import.test.js`：AC-03 all parser and access failures preserve the previous confirmed import
- `tests/integration/sheets-import/import.test.js`：AC-03 a failed insert rolls back deletion of the old import and can be retried
- `tests/integration/sheets-import/import.test.js`：AC-03 a Google read completing after activity opens cannot prepare a new import
- `tests/unit/sheets-import/gateway.test.js`：AC-03 maps safe permission, missing sheet, quota, network and timeout errors
- `tests/unit/sheets-import/gateway.test.js`：AC-03 missing local credentials do not trigger external requests or expose paths
- `tests/unit/sheets-import/gateway.test.js`：AC-03 a deleted sheet is an explicit error instead of silently importing a subset
- `tests/unit/sheets-import/parser.test.js`：AC-03 ignores ordinary text and formulas and rejects a sheet with no literal markers
- `tests/unit/sheets-import/parser.test.js`：AC-03 rejects malformed marker （多種標記）
- `tests/unit/sheets-import/parser.test.js`：AC-03 rejects an activity-wide duplicate across sheets and a singleton question group
- `tests/unit/sheets-import/parser.test.js`：AC-03 rejects a merged marker, respecting exclusive end coordinates

### AC-04

- `tests/integration/activity-groups/activity-groups.test.js`：AC-04 and AC-08 only preparation allows joining and a name cannot take over a group
- `tests/integration/realtime-buzzer/realtime-buzzer.test.js`：AC-04 10 student streams and the teacher synchronize a 20-question activity within two seconds
- `tests/unit/base-schema.test.js`：groups can join only while PREPARING (AC-04)
- `tests/unit/base-schema.test.js`：are accepted only while OPEN (AC-04, AC-10)
- `tests/unit/realtime-buzzer/submissions.test.js`：AC-04/10 checks the current phase before accepting, including a retry after close

### AC-05

- `tests/integration/realtime-buzzer/realtime-buzzer.test.js`：AC-05, AC-06, AC-07 teacher sees distinct sequence, genuine per-unit winners and unchanged retries
- `tests/unit/realtime-buzzer/submissions.test.js`：AC-05/06 assigns unique activity sequence numbers at the same timestamp and preserves order per unit

### AC-06

- `tests/integration/realtime-buzzer/realtime-buzzer.test.js`：AC-05, AC-06, AC-07 teacher sees distinct sequence, genuine per-unit winners and unchanged retries
- `tests/unit/base-schema.test.js`：one submission per group and unit; accept_seq unique per activity (AC-06, AC-07)
- `tests/unit/realtime-buzzer/submissions.test.js`：AC-05/06 assigns unique activity sequence numbers at the same timestamp and preserves order per unit

### AC-07

- `tests/integration/realtime-buzzer/realtime-buzzer.test.js`：AC-05, AC-06, AC-07 teacher sees distinct sequence, genuine per-unit winners and unchanged retries
- `tests/unit/base-schema.test.js`：one submission per group and unit; accept_seq unique per activity (AC-06, AC-07)
- `tests/unit/realtime-buzzer/submissions.test.js`：AC-07 returns the original opaque receipt on retry with a different valid answer

### AC-08

- `tests/integration/activity-groups/activity-groups.test.js`：AC-04 and AC-08 only preparation allows joining and a name cannot take over a group
- `tests/unit/base-schema.test.js`：unit and group must belong to the same activity (AC-08)
- `tests/unit/realtime-buzzer/submissions.test.js`：AC-08 rejects unknown identity, explicit identity claims, invalid units and invalid Unicode with no records

### AC-09

- `tests/integration/fair-ranking/fair-ranking.test.js`：AC-09 FR-012 a fair activity shows a group nothing about the others, and the teacher no provisional winner
- `tests/integration/realtime-buzzer/realtime-buzzer.test.js`：AC-09 and AC-16 student HTTP, SSE and errors disclose only its own answers

### AC-10

- `tests/integration/realtime-buzzer/realtime-buzzer.test.js`：AC-10 and AC-18 close and an atomic group submission share the same server order
- `tests/unit/base-schema.test.js`：are accepted only while OPEN (AC-04, AC-10)
- `tests/unit/realtime-buzzer/submissions.test.js`：AC-04/10 checks the current phase before accepting, including a retry after close

### AC-11

- `tests/integration/results-export/results-export.test.js`：AC-11 after closing, the teacher and every group read the same fixed results
- `tests/unit/results-export/results.test.js`：AC-11 closing a speed activity saves every final rank in the same transaction
- `tests/unit/results-export/results.test.js`：AC-11 saved results reject updates and deletes

### AC-12

- `tests/unit/results-export/sheets-export.test.js`：AC-12/AC-17 each winning answer is written as plain text to its own cell and verified by reading back

### AC-13

- `tests/unit/results-export/sheets-export.test.js`：AC-13 one conflicting target stops the whole write-back before any cell is written
- `tests/unit/results-export/sheets-export.test.js`：AC-13 a deleted sheet or removed rows are conflicts, never writes to the old coordinates

### AC-14

- `tests/unit/results-export/sheets-export.test.js`：AC-14 a refused write is reported as failed and the cells are not read back as success
- `tests/unit/results-export/sheets-export.test.js`：AC-14 a timed-out write is settled by reading the cells back
- `tests/unit/results-export/sheets-export.test.js`：AC-14 an unconfirmed write is pending verification, and the retry recognizes the written answers
- `tests/unit/results-export/sheets-export.test.js`：AC-14 repeating a finished write-back writes nothing and never overwrites an external edit

### AC-15

- `tests/integration/activity-groups/activity-groups.test.js`：AC-15 signed-in teacher and group resume after restarting the server
- `tests/integration/realtime-buzzer/realtime-buzzer.test.js`：AC-15 restarting restores phase and the same receipt without recording another submission
- `tests/integration/results-export/results-export.test.js`：AC-15 results stay the same after the server restarts

### AC-16

- `tests/integration/activity-groups/activity-groups.test.js`：AC-16 teacher login requires local configuration and checks Origin and CSRF
- `tests/integration/fair-ranking/fair-ranking.test.js`：FR-009 AC-16 students, anonymous callers and requests without Origin or CSRF cannot change the mode
- `tests/integration/realtime-buzzer/realtime-buzzer.test.js`：AC-09 and AC-16 student HTTP, SSE and errors disclose only its own answers

### AC-17

- `tests/integration/sheets-import/import.test.js`：AC-17 teacher chooses ordered sheets, previews five questions and atomically confirms three units
- `tests/unit/results-export/sheets-export.test.js`：AC-12/AC-17 each winning answer is written as plain text to its own cell and verified by reading back
- `tests/unit/sheets-import/parser.test.js`：AC-02 and AC-17 preserve teacher sheet order, row-major positions and groups across sheets

### AC-18

- `tests/integration/realtime-buzzer/realtime-buzzer.test.js`：AC-10 and AC-18 close and an atomic group submission share the same server order
- `tests/unit/realtime-buzzer/submissions.test.js`：AC-18 rejects missing, duplicate, unexpected, separately addressed, and invalid group answers
- `tests/unit/realtime-buzzer/submissions.test.js`：AC-18 rolls back both the sequence and all rows when the second member insert fails

### AC-19

- `tests/integration/results-export/results-export.test.js`：AC-19 the teacher downloads the same results as CSV after closing, and students cannot
- `tests/unit/results-export/csv.test.js`：AC-19 the CSV has a BOM, CRLF line endings, the fixed columns and one row per answered question

### AC-20

- `tests/unit/results-export/csv.test.js`：AC-20 only values that spreadsheet software could run as formulas get the guard quote

### AC-21

- `tests/integration/fair-ranking/fair-ranking.test.js`：AC-21 closing a fair activity saves fair ranks that the teacher and every group read alike
- `tests/unit/fair-ranking/fair-ranking.test.js`：V1 AC-21: A answers both units first, so B ranks first in the second unit

### AC-22

- `tests/integration/fair-ranking/fair-ranking.test.js`：AC-22 fair results stay the same after the server restarts
- `tests/unit/fair-ranking/fair-ranking.test.js`：V2 AC-22: equal win counts follow the acceptance sequence and the group with more wins ranks last
- `tests/unit/fair-ranking/fair-ranking.test.js`：V3 AC-22: a unit nobody answered adds no win, and a group unit counts as one win

### AC-23

- `tests/integration/fair-ranking/fair-ranking.test.js`：AC-23 once the activity is open or closed the mode cannot change, not even to the same mode
- `tests/integration/fair-ranking/fair-ranking.test.js`：AC-23 changing the mode and opening at the same moment has exactly one outcome
- `tests/integration/fair-ranking/fair-ranking.test.js`：AC-23 the result page, the CSV and the write-back preview agree on a fair activity
- `tests/unit/fair-ranking/modes.test.js`：AC-23 selecting before opening decides the mode the activity opens with, and opening locks it
- `tests/unit/fair-ranking/modes.test.js`：AC-23 opening first refuses a later selection and keeps the mode it opened with

### AC-24

- `tests/integration/activity-groups/activity-groups.test.js`：AC-24 a teacher has at most one unfinished activity, across sessions, until it closes
- `tests/integration/activity-groups/activity-groups.test.js`：AC-24 two sessions creating at the same moment leave exactly one activity
- `tests/integration/activity-groups/activity-groups.test.js`：AC-24 join codes are six characters without the easily confused 0, O, 1 and I
- `tests/integration/activity-groups/activity-groups.test.js`：AC-24 a group name is 1 to 30 Unicode characters after trimming
- `tests/integration/activity-groups/activity-groups.test.js`：AC-24 groups joining with the same name at the same moment: only one succeeds
