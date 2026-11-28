---

description: "SF-04 結果與匯出的任務清單"
---

# Tasks: SF-04 結果與匯出

**Input**: Design documents from `specs/004-results-export/`

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/](contracts/)

**Tests**: constitution V 要求排序、交易、權限與隱私過濾、CSV 等核心邏輯測試先行，因此每個階段都先寫測試，確認失敗後才實作。

**Organization**: 結果的保存與讀取是三個 user story 共同的前提，放在 Foundational；之後每個 user story 各自可獨立測試。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可平行（不同檔案、不依賴未完成的任務）
- **[Story]**：所屬 user story（US1 結果檢視、US2 寫回 Sheets、US3 CSV）

## Path Conventions

單一專案：後端 `src/`、前端 `public/`、測試 `tests/`（見 plan.md 的 Project Structure）。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 掛載 SF-04 router、共用 Sheets gateway

- [X] T001 建立 `src/features/results-export/router.js`，匯出回傳空 Express `Router` 的 `createResultsExportRouter(deps)`，並在 `src/app.js` 以 `api.use(createResultsExportRouter(deps))` 取代 SF-04 的註解行（掛在 `createSheetsImportRouter` 之後）；同時讓 `createApp` 在未注入 `sheetsGateway` 時，以 `createSheetsGateway({ credentialsFile: config.googleCredentialsFile, clock })` 建立一個實例放進 `deps`，供 SF-02 與 SF-04 共用（research R10）

---

## Phase 2: Foundational (結束時保存結果並可讀取)

**Purpose**: 結束交易內保存速度模式結果、提供共用的結果檢視；US1～US3 都依賴這一階段

**⚠️ CRITICAL**: 本階段完成前不得開始任何 user story

### Tests（先寫並確認失敗）

- [X] T002 [P] 在 `tests/unit/results-export/ranking.test.js` 為 `rankSpeed` 寫測試：每個單位依 `acceptSeq` 由小到大給 `finalRank` 1、2、3…；沒有受理的單位不產生資料；同一組在不同單位各自排名；回傳 `{ submissionId, unitId, finalRank }`（[contracts/ranking.md](contracts/ranking.md)）
- [X] T003 [P] 在 `tests/unit/results-export/results.test.js` 以 `tests/helpers/fixtures.js` 與 SF-03 的 `transitionActivity` 寫測試：(a) 結束時同交易保存結果——單題 A 組 `final_rank` 1、B 組 2，題組由 B 組勝出且每筆受理只有一列，無人作答單位沒有結果（AC-11）；(b) `results` 的 UPDATE、DELETE 被拒絕（AC-11）；(c) `mode = 'FAIR'` 時結束丟出 409 `RANKING_UNAVAILABLE`，活動仍為 `OPEN` 且沒有結果（FR-002、FR-007）；(d) `readResults` 回傳 data-model.md 的 `ResultView`：`label` 為 `Q:<題號>`／`G:<題組代號>`、`noAnswer`、`entries` 依 `rank` 排序並含 `groupName`、`acceptedOrder`（單位內 `accept_seq` 名次）、`acceptedAt`、`rank`、`isWinner`、依 `position_in_unit` 排列的 `answers`，且不含組別 ID、受理序號、受理識別；(e) 未結束時 409 `INVALID_PHASE`，有受理缺結果時 409 `RESULTS_UNAVAILABLE`
- [X] T004 [P] 在 `tests/unit/results-export/backfill.test.js` 測試 migration 補齊：把 `src/db/migrations/` 中 `004-` 以外的檔案複製到暫存目錄並 `migrate(db, { dir })`，以 fixtures 建立「已結束、速度模式、有受理、沒有結果」的活動，另建一個已結束的公平模式活動，再以預設目錄 `migrate(db)`；速度模式活動依 `accept_seq` 補齊 `final_rank` 與 `is_winner`，公平模式活動維持沒有結果

### Implementation

- [X] T005 [P] 在 `src/features/results-export/ranking.js` 實作同步純函式 `rankSpeed(units)` 與 `export const RANKERS = Object.freeze({ SPEED: rankSpeed })`
- [X] T006 在 `src/features/results-export/results.js` 實作 `saveFinalResults(db, activityId, mode)`：依 `units.position` 讀取各單位，受理依 `accept_seq` 排列為 `{ submissionId, groupId, acceptSeq }`；`RANKERS[mode]` 不存在時丟出 `conflict('RANKING_UNAVAILABLE', '這個模式的結果計算尚未提供，無法結束活動。')`；以 `INSERT INTO results (submission_id, unit_id, final_rank, is_winner)` 寫入，`is_winner = finalRank === 1 ? 1 : 0`。函式在呼叫端的交易內執行，不自行開交易、不 `await`
- [X] T007 在 `src/features/realtime-buzzer/state.js` 的結束分支，於 `UPDATE ... status = 'CLOSED'` 之後呼叫 `saveFinalResults(db, id, activity.mode)`，取代 SF-04 的註解
- [X] T008 在 `src/features/results-export/results.js` 實作 `readResults(db, activityId)`：`getActivity` 確認存在；非 `CLOSED` 時丟出 `conflict('INVALID_PHASE', '活動結束後才能查看結果。')`；依 data-model.md 組出 `ResultView`（`acceptedOrder` 以 `ROW_NUMBER() OVER (PARTITION BY unit_id ORDER BY accept_seq)` 計算）；有受理沒有結果列時丟出 `conflict('RESULTS_UNAVAILABLE', '這場活動沒有保存結果。')`
- [X] T009 建立 `src/db/migrations/004-01-backfill-speed-results.sql`：對 `status = 'CLOSED' AND mode = 'SPEED'` 且尚無任何 `results` 的活動，以 `ROW_NUMBER() OVER (PARTITION BY s.unit_id ORDER BY s.accept_seq)` 寫入 `final_rank`，`is_winner = (final_rank = 1)`（research R12）
- [X] T010 執行 `node --test tests/unit/results-export tests/unit/realtime-buzzer tests/integration/realtime-buzzer`，確認新測試通過且 SF-03 的結束流程不受影響

**Checkpoint**: 結束活動即保存結果，`readResults` 可提供結果檢視

---

## Phase 3: User Story 1 - 結束時保存結果並查看 (Priority: P1) 🎯 MVP

**Goal**: 結束後老師與該活動的各組自動看到固定的完整結果（FR-001～FR-007）

**Independent Test**: 兩組作答後結束活動，老師與兩組畫面顯示相同結果；重啟後不變；結束前學生拿不到任何結果

### Tests for User Story 1（先寫並確認失敗）

- [X] T011 [US1] 在 `tests/integration/results-export/results-export.test.js` 以 `startTestApp`、`browser()` 寫 HTTP 測試：教師登入、建立活動、兩組加入（fixtures 建立題目）、開啟、送出後結束；`GET /api/teacher/activities/:id/results` 結束前 409 `INVALID_PHASE`、結束後 200；`GET /api/student/results` 結束前 409 且回應不含其他組名稱或答案（AC-09），結束後與教師回應相同（FR-003）；學生呼叫教師結果端點 401；未登入 401；另一場活動的學生只拿到自己活動的狀態（409），不含本活動資料；以檔案型 SQLite 關閉後用新的 app 開啟同一檔案，結果相同（AC-15）

### Implementation for User Story 1

- [X] T012 [US1] 在 `src/features/results-export/router.js` 新增 `GET /teacher/activities/:activityId/results`（`requireTeacher`，回傳 `readResults`）與 `GET /student/results`（`requireGroupSession`，回傳 `readResults(db, req.groupSession.activityId)`）（[contracts/http-api.md](contracts/http-api.md)）
- [X] T013 [P] [US1] 建立 `public/js/results-view.js`，匯出 `renderResults(container, view)`：每個單位一個 `section`，標題為 `第 X 題` 或 `題組（第 X 題、第 Y 題）`，勝出列為 `勝出：<組名>` 或 `無人作答`，表格欄位為「最終順位、組別、受理順序、受理時間、各題答案」，`caption` 標示模式；所有使用者輸入只經 `h()`／`setText()`（textContent）
- [X] T014 [US1] 建立 `public/teacher/results-export.js`，並在 `public/teacher/index.html` 的 `#teacher-buzzer` 之後加入 `<section id="results-export" hidden></section>`、於 `/teacher/activity-groups.js` 之前載入模組：收到 `teacher-activity` 或 `teacher-activity-phase` 且狀態為 `CLOSED` 時取一次結果並以 `renderResults` 呈現；切換活動時清空；錯誤以 `role="alert"` 文字顯示
- [X] T015 [US1] 建立 `public/student/results-export.js`，並在 `public/student/index.html` 的 `#student-buzzer` 之後加入 `<section id="student-results" hidden></section>`、於 `/student/activity-groups.js` 之前載入模組：收到 `student-activity-closed` 時取 `/api/student/results` 並呈現；收到 `student-activity` 時清空
- [X] T016 [US1] 在 `public/teacher/realtime-buzzer.js` 讓監看表在活動 `CLOSED` 後隱藏（保留階段文字），由結果表取代（research R13）

**Checkpoint**: US1 可獨立驗收（AC-11、AC-15 的結果部分）

---

## Phase 4: User Story 2 - 預覽並寫回原雲端 Google Sheets (Priority: P2)

**Goal**: 老師預覽後把勝出答案以純文字寫回原答案格；衝突整批停止；不誤報成功；可安全重試（FR-008～FR-018）

**Independent Test**: 以假的 gateway 涵蓋成功、各種衝突、權限不足、逾時與重試；再以真實雲端試算表人工驗收

### Tests for User Story 2（先寫並確認失敗）

- [X] T017 [P] [US2] 在 `tests/unit/sheets-import/gateway.test.js` 新增請求格式測試：`readTargets` 先以 `fields=sheets(properties(sheetId,title,sheetType,gridProperties),merges)` 讀取中繼資料，再只對「工作表存在且在格線內」的目標送 `:getByDataFilter`（1×1 `gridRange`，`fields` 含 `data(startRow,startColumn,rowData(values(userEnteredValue)))`），沒有可讀目標時不送第二個請求；`writeCells` 送 `POST …:batchUpdate?fields=spreadsheetId`，每格一個 `updateCells`（`range` 為 `sheetId` 與 0-based 起訖列欄、`rows[0].values[0].userEnteredValue.stringValue`、`fields: 'userEnteredValue'`）；Google 錯誤沿用既有代碼
- [X] T018 [P] [US2] 在 `tests/unit/results-export/sheets-export.test.js` 為 `classifyTarget` 寫測試：`SHEET_MISSING`、`OUT_OF_RANGE`（列 ≥ `rowCount` 或欄 ≥ `columnCount`）、`MERGED`、`ALREADY_PRESENT`（`\r\n`、`\r` 正規化為 `\n` 後相同）、`READY`（去除前後空白後等於去除前後空白的 `original_marker`，含全形空白）、`CHANGED`（空白、數字、公式、其他文字）；工作表改名後仍為 `READY`，並回傳目前的工作表名稱
- [X] T019 [US2] 在 `tests/unit/results-export/sheets-export.test.js` 以 fixtures 與假的 gateway 測試匯出器：預覽逐題狀態與 `counts`（含 `NO_ANSWER`），不呼叫 `writeCells`；全部可寫入時寫入、回讀後 `WRITTEN`、整批 `SUCCEEDED`（AC-12、AC-17：題組各題各寫自己的格子）；任一衝突時不呼叫 `writeCells`，衝突題 `CONFLICT`、其餘 `SKIPPED`、整批 `CONFLICT`（AC-13）；`SHEETS_PERMISSION` 時 `FAILED`；逾時且回讀為答案時 `WRITTEN`、回讀仍為標記時 `FAILED`、回讀失敗時 `UNKNOWN`（AC-14）；`UNKNOWN` 之後重試，格子已是答案時 `ALREADY_PRESENT` 且不寫入；外部改寫為其他內容時 `CONFLICT` 且不覆寫；整批成功後重複寫回全部 `ALREADY_PRESENT`、不呼叫 `writeCells`；同活動並行時 409 `EXPORT_IN_PROGRESS`；遺留 `RUNNING` 改為 `UNKNOWN`（`INTERRUPTED`），其 `PENDING` 題目改為 `UNKNOWN`；`editsPaused` 不是 `true` 時 400 `EDITS_PAUSE_REQUIRED`；沒有勝出答案時 409 `NOTHING_TO_EXPORT`；寫回前後 `results` 不變（FR-018）
- [X] T020 [P] [US2] 在 `tests/integration/results-export/results-export.test.js` 以注入的假 gateway 測試寫回端點：預覽、寫回、最近紀錄只限教師（學生 401）；POST 缺少 Origin 或 CSRF 時 403；結束前 409 `INVALID_PHASE`；尚未寫回時最近紀錄為 `null`

### Implementation for User Story 2

- [X] T021 [P] [US2] 建立 `src/db/migrations/004-02-sheet-exports.sql`：`sheet_exports`（`outcome` CHECK 為 `RUNNING`、`SUCCEEDED`、`CONFLICT`、`FAILED`、`UNKNOWN`）、`sheet_export_items`（PK `(export_id, question_id)`，`status` CHECK 為 `PENDING`、`WRITTEN`、`ALREADY_PRESENT`、`CONFLICT`、`SKIPPED`、`FAILED`、`UNKNOWN`），以及 `CREATE UNIQUE INDEX ... ON sheet_exports (activity_id) WHERE outcome = 'RUNNING'`（data-model.md）
- [X] T022 [P] [US2] 在 `src/features/sheets-import/gateway.js` 新增 `readTargets(spreadsheetId, targets)` 與 `writeCells(spreadsheetId, cells)`，沿用 `requestSheet` 的授權、逾時與錯誤對應（research R4、R5）
- [X] T023 [US2] 在 `src/features/results-export/results.js` 實作 `listWinningAnswers(db, activityId)`：依單位與組內題序列出每題的題號、單位代號、目標（`spreadsheet_id`、`sheet_id`、`sheet_title`、`row_index`、`column_index`、`original_marker`）、勝出組名與答案（無人作答為 `null`）
- [X] T024 [US2] 實作 `src/features/results-export/export-records.js`：`startRun`（交易內先把遺留的 `RUNNING` 改為 `UNKNOWN`／`INTERRUPTED` 並把其 `PENDING` 題目改為 `UNKNOWN`，再新增 `RUNNING`）、`recordItems`、`finishRun`、`latestExport`（遺留 `RUNNING` 同樣先結算）；每個函式各自是短的同步交易
- [X] T025 [US2] 在 `src/features/results-export/sheets-export.js` 實作純函式 `classifyTarget` 與 `createSheetsExporter(deps)`（`preview`、`run`、`latest`；程序內的寫回中活動集合；寫入前核對、整批停止、單一 `writeCells`、回讀判定、不確定時 `UNKNOWN`；research R6～R9、R14）
- [X] T026 [US2] 在 `src/features/results-export/router.js` 新增 `POST /teacher/activities/:activityId/sheets-export/preview`、`POST /teacher/activities/:activityId/sheets-export`（兩者皆 `requireTeacher` 與 `requireMutation(deps, 'teacher')`）與 `GET /teacher/activities/:activityId/sheets-export`
- [X] T027 [US2] 在 `public/teacher/results-export.js` 加入寫回區：「預覽寫回」按鈕與預覽表（題號、勝出組、答案、目標、狀態），有衝突時以文字提示恢復原結構或另建活動重新匯入；標籤為「我已請其他人暫停編輯這份試算表」的核取方塊；只有預覽無衝突且已勾選時才啟用「寫回試算表」；與 Google 連線時以 `role="status"` 顯示進行中；顯示逐題結果與整批結果（非 `SUCCEEDED` 一律顯示未完成），並提醒恢復其他人的編輯；載入時顯示最近一次紀錄

**Checkpoint**: US2 以假的 gateway 全部通過；真實雲端試算表的人工驗收見 quickstart.md

---

## Phase 5: User Story 3 - 下載 CSV 結果 (Priority: P3)

**Goal**: 老師下載與結果頁一致、可安全開啟的 CSV（FR-019～FR-025）

**Independent Test**: 以含中文、引號、逗號、換行、公式開頭字元與無人作答的結果產生 CSV，逐欄比對

### Tests for User Story 3（先寫並確認失敗）

- [X] T028 [P] [US3] 在 `tests/unit/results-export/csv.test.js` 為 `buildResultsCsv` 寫測試：以 `﻿` 開頭、CRLF 分隔且結尾有 CRLF；標題列為 `activity_id,mode,unit_id,question_id,group_name,answer,accepted_at,accepted_order,rank,is_winner`；依單位順序、最終順位、組內題序展開；無人作答題一列且 `group_name`、`answer`、`accepted_at`、`accepted_order`、`rank` 為空、`is_winner` 為 `false`；含 `,`、`"`、CR、LF 的欄位加雙引號並把 `"` 重複；`unit_id`、`question_id`、`group_name`、`answer` 去除前導空白後以 `=`、`+`、`-`、`@` 開頭或以 tab、CR、LF 開頭時前面加 `'`，一般文字不加（AC-19、AC-20）
- [X] T029 [P] [US3] 在 `tests/integration/results-export/results-export.test.js` 測試 `GET /api/teacher/activities/:id/results.csv`：結束後 200，`Content-Type: text/csv; charset=utf-8`、`Content-Disposition` 為 `attachment; filename="results-<activityId>.csv"`，內容與結果一致；結束前 409；學生 401；下載後資料庫中的答案原值不變

### Implementation for User Story 3

- [X] T030 [US3] 在 `src/features/results-export/csv.js` 實作 `buildResultsCsv(view)`（research R11）
- [X] T031 [US3] 在 `src/features/results-export/router.js` 新增 `GET /teacher/activities/:activityId/results.csv`（`requireTeacher`）
- [X] T032 [US3] 在 `public/teacher/results-export.js` 的結果區加入「下載 CSV」連結（`href` 指向 CSV 端點、`download` 屬性）

**Checkpoint**: 三個 user story 都可獨立運作

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T033 執行 `npm test`，全部通過
- [X] T034 以 `npm start` 啟動並以瀏覽器走一次 quickstart.md 的本機流程（結果自動顯示、CSV 下載），確認畫面與鍵盤操作
- [X] T035 建立 `specs/004-results-export/acceptance.md`：列出每個 AC 對應的自動化測試，以及待真實雲端試算表與試算表軟體完成的人工驗收項目（AC-12、AC-13、AC-14、AC-17、AC-02、AC-20）
- [X] T036 依 `after_implement` hook 執行 `/speckit-plantuml-sync`，產生 `specs/004-results-export/diagram-sync.md` 並更新圖表
- [X] T037 [US3] （#32，AC-26）在 `tests/integration/results-export/results-export.test.js` 的 CSV 下載測試確認 `unit_id` 標籤與 JSON 內部 ID；程式與圖表不變
- [X] T038 [US1] （#32）`accepted_order` 改用整場受理序號：`src/features/results-export/results.js`、`public/teacher/realtime-buzzer.js`，更新結果與公平排序測試及 SF-03～SF-05 文件；圖表不變

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**：無依賴
- **Foundational（Phase 2）**：依賴 Setup；完成前不得開始任何 user story
- **US1、US2、US3（Phase 3～5）**：都只依賴 Foundational，彼此獨立；依優先順序 P1 → P2 → P3 進行
- **Polish（Phase 6）**：依賴所有 user story

### Within Each Phase

- 測試先寫並確認失敗，再實作
- `ranking.js` → `results.js` → `state.js` 接點
- migration、gateway → `export-records.js` → `sheets-export.js` → router → 前端
- `router.js` 與 `public/teacher/results-export.js` 被多個 story 修改，同一檔案的任務依序進行

### Parallel Opportunities

- T002、T003、T004 可平行（不同測試檔）
- T017、T018、T020 可平行；T021、T022 可平行
- T028、T029 可平行
- US2 與 US3 在 Foundational 完成後可平行（只在 `router.js`、`public/teacher/results-export.js` 需要依序合併）

---

## Parallel Example: User Story 2

```bash
# 先平行寫測試：
Task: "T017 gateway readTargets／writeCells 請求格式測試 in tests/unit/sheets-import/gateway.test.js"
Task: "T018 classifyTarget 測試 in tests/unit/results-export/sheets-export.test.js"
Task: "T020 寫回端點權限測試 in tests/integration/results-export/results-export.test.js"

# 再平行實作互不依賴的基礎：
Task: "T021 004-02-sheet-exports.sql"
Task: "T022 gateway readTargets／writeCells"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → Phase 2 Foundational（結束時保存結果）
2. Phase 3 US1：結果檢視
3. **STOP and VALIDATE**：AC-11、AC-15 的結果部分

### Incremental Delivery

1. Setup＋Foundational → 結束即保存結果
2. US1 → 老師與學生看到結果（MVP）
3. US2 → 寫回原試算表（自動化測試通過；人工驗收待服務帳戶）
4. US3 → CSV 下載
5. Polish → 完整測試、瀏覽器檢查、驗收紀錄、圖表同步

---

## Notes

- [P] 任務 = 不同檔案、沒有未完成的依賴
- 每完成一組相關任務就以 `/commit-claude` 格式提交
- 不修改根目錄 `spec.md`；跨子功能的修改（`state.js`、`gateway.js`、`realtime-buzzer.js`、`app.js`）在 PR 中請負責人確認
