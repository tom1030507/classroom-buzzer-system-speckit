# SF-04 研究與設計決策

對應 [plan.md](plan.md) 的 Phase 0。所有決策都以 [spec.md](spec.md)、根目錄 `spec.md` 與 constitution 為準，
並沿用 SF-01～SF-03 已建立的程式慣例。Technical Context 沒有待釐清項目。

## R1. 結果在結束交易中計算與保存

- **Decision**：SF-03 `transitionActivity` 的結束分支在 `UPDATE ... status = 'CLOSED'` 之後呼叫
  `saveFinalResults(db, activityId, mode)`。函式依 `RANKERS[mode]` 計算每筆受理的最終順位並寫入 `results`，
  全程在同一個 `withTransaction` 同步交易內，任何錯誤整筆回滾（活動維持 OPEN）。
- **Rationale**：spec.md §4 與 constitution III 要求結束狀態與完整結果同交易保存；`results_only_when_closed`
  trigger 只允許在 CLOSED 時寫入，所以必須在狀態更新之後、提交之前執行。SF-03 已在該位置留下接點。
- **公平模式**：`RANKERS` 只有 `SPEED`。遇到沒有計算方式的模式時丟出 409 `RANKING_UNAVAILABLE`，
  不以速度規則替公平模式保存結果（結果一經保存不可修改）。SF-05 加入 `FAIR` 後即可結束公平模式活動；
  在那之前介面也無法選擇公平模式（模式選擇屬於 SF-05 #19）。
- **Alternatives considered**：讀取時才計算結果（違反 §4 的同交易保存與不可變）；另建結果資料表
  （基礎模型已有 `results`）。

## R2. 實際受理順序不另存

- **Decision**：`accepted_order` 直接使用 `submissions.accept_seq`，即整場活動的受理序號（2026-11-28，#32）。
- **Rationale**：`accept_seq` 是唯一的事實來源且不可修改，不需要另存；根目錄 `spec.md` FR-04、FR-09 稱它為
  受理序號，另一 OpenSpec 小組也用整場序號。
- **Alternatives considered**：以 `ROW_NUMBER() OVER (PARTITION BY unit_id ORDER BY accept_seq)` 算單位內名次
  （2026-11-20 的原決定，與另一小組不一致而改掉）；在 `results` 新增欄位（重複資料，且基礎模型已註明受理順序看
  `accept_seq`）。

## R3. 結果以獨立 API 提供，不放進 SSE 快照

- **Decision**：新增 `GET /api/teacher/activities/:activityId/results` 與 `GET /api/student/results`。
  前端在收到 SF-03 的 `teacher-activity-phase`／`student-activity-closed` 事件（SSE 快照顯示 CLOSED）後各取一次。
- **Rationale**：結果結束後就不會改變。SF-03 的串流每 250 毫秒為每個連線序列化一次快照；若把所有組的答案
  （10 組 × 20 題 × 最多 1,000 字）放進學生快照，會不斷重複序列化不變的大資料，也要改動 SF-03 的隱私投影。
  獨立 API 讓授權邏輯集中在 SF-04，SF-03 的快照維持不變。結束事件在 2 秒內送達，結果隨即載入（SC-001）。
- **Alternatives considered**：在 `teacherSnapshot`／`studentSnapshot` 加入結果（理由同上）。

## R4. 寫入使用 `spreadsheets.batchUpdate` 的 `updateCells`

- **Decision**：`writeCells` 送出單一 `POST /v4/spreadsheets/{id}:batchUpdate`，每個目標一個 `updateCells`：
  以 `sheetId` 與 0-based 列欄指定 1×1 `GridRange`，`rows[0].values[0].userEnteredValue.stringValue` 為答案原文，
  `fields` 為 `userEnteredValue`。
- **Rationale**：
  - Google 文件明載：「If any request is not valid then the entire request will fail and nothing will be applied」，
    且「the updates in the request will be applied together atomically」。整批寫入不會只寫一半。
  - `ExtendedValue` 的 `stringValue` 與 `formulaValue` 是不同型別，`stringValue` 一律存成純文字，
    `=1+1` 不會變成公式，效果等同 values API 的 `RAW`（FR-013、AC-12）。
  - `fields: userEnteredValue` 只改值，不動格式、備註與資料驗證。
  - 以 `sheetId` 定位，工作表改名不影響寫入，也不需要處理 A1 表示法中工作表名稱的跳脫。
- **Alternatives considered**：`values.batchUpdate` 搭配 `valueInputOption=RAW`（需要目前的工作表名稱與 A1 跳脫，
  文件未保證整批原子性）；逐格寫入（可能部分完成）。

## R5. 讀取目標格分兩步

- **Decision**：`readTargets` 先以 `GET /v4/spreadsheets/{id}?fields=sheets(properties(sheetId,title,sheetType,gridProperties),merges)`
  取得所有工作表、格線大小與合併範圍；再對「工作表存在且在範圍內」的目標格，以 `:getByDataFilter`
  讀取 1×1 `gridRange` 的 `userEnteredValue`。
- **Rationale**：工作表被刪除或列欄被刪減時，第二步不會因不存在的 `sheetId` 或超出範圍的格位而整批失敗，
  也能逐題指出原因。`userEnteredValue` 是使用者輸入的原值（字串、數字或公式），比顯示值更適合核對標記。
  SF-02 已使用相同的 `getByDataFilter` 欄位格式。
- **Alternatives considered**：沿用 `readSheets` 讀整張表（工作表不存在時整批丟錯且無法指出是哪一張，
  也讀取不必要的資料）；`values.batchGet`（需要工作表名稱，且預設回傳顯示值）。

## R6. 目標格的判定規則

- **Decision**：純函式 `classifyTarget(target, observed)` 依序判定：
  1. 工作表不存在 → 衝突 `SHEET_MISSING`。
  2. 列或欄超出目前格線 → 衝突 `OUT_OF_RANGE`。
  3. 格子落在任一合併範圍 → 衝突 `MERGED`。
  4. 值為字串且換行正規化（`\r\n`、`\r` → `\n`）後等於要寫入的答案 → `ALREADY_PRESENT`。
  5. 值為字串且去除前後空白後等於匯入時的標記（同樣去除前後空白）→ `READY`。
  6. 其他（空白、數字、公式、其他文字）→ 衝突 `CHANGED`。
- **Rationale**：標記比對與 SF-02 解析規則一致（匯入時允許前後空白，`original_marker` 保存原始字串）。
  先比對答案，讓逾時後實際已寫入的格子被辨識為成功（FR-016）。
- **Alternatives considered**：在其他位置搜尋原標記並改寫新位置（違反「不得猜測新位置」，FR-011）。

## R7. 任一衝突就整批停止

- **Decision**：預覽與寫入前的核對只要有任一衝突，就不呼叫 `writeCells`；衝突題記為 `CONFLICT`，其他題記為 `SKIPPED`。
- **Rationale**：根目錄 FR-07 要求偵測到衝突就停止，並提示恢復原結構或另建活動重新匯入。若只寫入未衝突的格子，
  這些格子的標記會被答案取代，之後就無法另建活動重新匯入這些題目。

## R8. 寫入結果不確定時以回讀判定

- **Decision**：
  - `writeCells` 回報權限不足（`SHEETS_PERMISSION`）、找不到試算表（`SHEETS_NOT_FOUND`）、配額（`SHEETS_QUOTA`）、
    憑證或驗證錯誤（`SHEETS_CREDENTIALS`、`SHEETS_AUTH`）時，Google 沒有套用這批更新，待寫入的題目記為 `FAILED`。
  - 寫入成功，或錯誤無法確定是否已套用（逾時、斷線、Google 5xx、回應格式錯誤）時，立即回讀目標格：
    內容一致 → `WRITTEN`；仍是原標記 → `FAILED`；其他內容 → `CONFLICT`（`READBACK_MISMATCH`，不覆寫）。
  - 回讀也失敗時，待寫入的題目記為 `UNKNOWN`（待核對）。下次寫回會先核對線上值（R6 第 4、5 點）。
- **Rationale**：只有回讀確認的格子才算成功（FR-014）；無法確定時如實顯示「待核對」（FR-016）。

## R9. 同活動互斥與中斷復原

- **Decision**：
  - 每個 app 的匯出器保存一個「寫回中的活動」集合。同一活動已在集合中時，回應 409 `EXPORT_IN_PROGRESS`。
  - `sheet_exports` 以部分唯一索引 `UNIQUE (activity_id) WHERE outcome = 'RUNNING'` 作為資料庫層防線。
  - 讀取紀錄或開始新的寫回時，若資料庫有 `RUNNING` 的紀錄但該活動不在集合中，代表上次寫回被中斷
    （例如伺服器重啟），就把該紀錄改為 `UNKNOWN`（`error_code = 'INTERRUPTED'`），其中 `PENDING` 的題目改為 `UNKNOWN`。
- **Rationale**：服務只在單一 Node.js 程序執行（constitution III），程序內的集合足以互斥；重啟後集合為空，
  遺留的 `RUNNING` 必定已中斷。資料庫索引防止程式錯誤造成兩筆同時進行。
- **交易邊界**：資料庫寫入（開始、逐題紀錄、結束）各自是短的同步交易；`await` Google 的期間不持有交易
  （`withTransaction` 禁止 async callback）。

## R10. 共用同一個 Gateway

- **Decision**：`createApp` 在未注入 `sheetsGateway` 時建立一個實例，放進 `deps`，SF-02 與 SF-04 共用。
- **Rationale**：只保留一份 access token 快取；建立實例不會讀取憑證（第一次呼叫 Google 時才讀取）。
  SF-02 router 原本就優先使用 `deps.sheetsGateway`，不需要修改。測試照舊注入假的 gateway。

## R11. CSV 由程式直接產生

- **Decision**：`buildResultsCsv(view)` 輸出 `﻿` 開頭、CRLF 分隔、結尾含 CRLF 的字串。
  欄位含 `,`、`"`、CR 或 LF 時以雙引號包住並把 `"` 重複一次。`unit_id`、`question_id`、`group_name`、`answer`
  套用公式防護：去除前導空白後以 `=`、`+`、`-`、`@` 開頭，或原值以 tab、CR、LF 開頭時，在原值前加 `'`。
  回應標頭為 `text/csv; charset=utf-8` 與 `Content-Disposition: attachment; filename="results-<activityId>.csv"`。
- **Rationale**：格式規則簡單且固定，不需要新增套件（constitution VII）。資料量上限約為 10 組 × 20 題，一次產生即可。
- **Alternatives considered**：CSV 套件（新增相依且仍需自行處理公式防護）；串流輸出（資料量小，不需要）。

## R12. 補齊上線前已結束活動的結果

- **Decision**：migration `004-01-backfill-speed-results.sql` 對「已結束、速度模式、尚無任何結果」的活動，
  以 `ROW_NUMBER()` 依受理序號補寫 `results`。
- **Rationale**：SF-03 合併後、SF-04 合併前結束的活動沒有結果（Assumptions 最後一點）。規則與結束時完全相同，
  且受理紀錄不可修改，補寫的結果與當時保存的結果一致。公平模式無法在 SQL 中補算，維持沒有結果，讀取時回應
  `RESULTS_UNAVAILABLE`（介面無法選擇公平模式，實際上不會發生）。

## R13. 前端整合

- **Decision**：
  - 教師頁新增 `public/teacher/results-export.js` 與 `#results-export` 區塊：結果表、寫回預覽與確認、
    逐題寫回結果、下載 CSV 連結。監聽 `teacher-activity` 與 `teacher-activity-phase`。
  - 學生頁新增 `public/student/results-export.js` 與 `#student-results` 區塊，監聽 `student-activity` 與
    `student-activity-closed`。
  - SF-03 教師監看表在 CLOSED 後隱藏，由結果表取代（`public/teacher/realtime-buzzer.js` 的小幅修改，PR 中請 SF-03 負責人確認）。
- **Rationale**：沿用 SF-01～SF-03 以 CustomEvent 協調各區塊的做法；結束後同一頁不會出現兩份重複的作答表。

## R14. 預覽與確認不使用 preview token

- **Decision**：寫回時伺服器一律重新讀取並核對，不依賴預覽結果。前端只有在最近一次預覽沒有衝突、
  且老師勾選「已暫停其他人編輯」時才啟用寫回按鈕；後端要求 `editsPaused: true`。
- **Rationale**：結束後結果與目標格不會改變，預覽內容可由伺服器重現；寫入前的核對才是安全保證（FR-010）。

## 已知風險（人工驗收時確認）

- 以 `'` 開頭的答案：`stringValue` 會保留原文，但需在真實試算表確認回讀內容一致，否則會被判為 `READBACK_MISMATCH`。
- Google API 配額（每位使用者每分鐘讀取上限）：每次預覽 2 次讀取、每次寫回最多 4 次呼叫，課堂使用不會觸及上限。
