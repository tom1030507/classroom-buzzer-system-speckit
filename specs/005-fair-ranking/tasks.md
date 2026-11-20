---

description: "SF-05 公平排序的任務清單"
---

# Tasks: SF-05 公平排序

**Input**: Design documents from `specs/005-fair-ranking/`

**Prerequisites**: [plan.md](plan.md)、[spec.md](spec.md)、[research.md](research.md)、[data-model.md](data-model.md)、[contracts/](contracts/)

**Tests**: constitution V 要求排序與公平順位、交易與並行、權限與隱私過濾等核心邏輯測試先行，因此每個 user story 都先寫測試並確認失敗，才實作。前端模組沒有自動化測試，沿用 SF-04 的做法，以 Polish 階段的瀏覽器檢查與截圖驗證。

**Organization**: 公平順位計算（US1）與模式選擇（US2）都是 P1；結果頁、寫回與 CSV 的一致性（US3）需要前兩者。SF-04 已提供結果保存、結果檢視、寫回與 CSV，所以沒有需要重做的基礎工作，只有一個前端共用模組放在 Foundational。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可平行（不同檔案、不依賴未完成的任務）
- **[Story]**：所屬 user story（US1 公平順位計算、US2 模式選擇與鎖定、US3 結果整合與一致性）

## Path Conventions

單一專案：後端 `src/`、前端 `public/`、測試 `tests/`（見 plan.md 的 Project Structure）。測試以 `node --test '<glob>'` 執行（目錄不能直接當參數）。

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 掛載 SF-05 router

- [X] T001 [P] 建立 `src/features/fair-ranking/router.js`，匯出回傳空 Express `Router` 的 `createFairRankingRouter(deps)`；在 `src/app.js` 加入 `import { createFairRankingRouter } from './features/fair-ranking/router.js'`，並以 `api.use(createFairRankingRouter(deps));` 取代預留的 `//   api.use(createFairRankingRouter(deps));      // SF-05 005-fair-ranking` 註解行（掛在 `createResultsExportRouter` 之後）

---

## Phase 2: Foundational (共用的模式說明文字)

**Purpose**: 老師、學生與結果頁共用同一份模式名稱與規則說明；US2、US3 都使用

- [X] T002 [P] 建立 `public/js/mode-rules.js`：匯出凍結的 `modeLabel = { SPEED: '速度模式', FAIR: '公平模式' }`、凍結的 `modeRule`（`{ SPEED: string[], FAIR: string[] }`，每個元素一個段落，文字依 [research.md R7](research.md#r7-規則說明是前端固定常數) 的草稿；公平模式最後一段是只用「某組」「另一組」泛稱的簡短範例，不含任何組名或活動資料），以及 `renderModeRule(mode)`：回傳 `h('div', { class: 'mode-rule' }, ...)`，每個段落一個 `<p>`，只經 `/js/dom.js` 的 `h()` 以文字節點呈現；未知模式回傳空的 `div`（FR-010、FR-014，research R7）

**Checkpoint**: 前端有單一的模式說明來源

---

## Phase 3: User Story 1 - 公平模式結束時計算並保存順位 (Priority: P1，#18) 🎯 MVP

**Goal**: 結束公平模式活動時，在同一交易內依公平規則計算並保存最終順位；結果固定、重啟後不變（FR-001～FR-006）

**Independent Test**: 兩到三組、兩到三個單位的公平模式活動，製造 AC-21、AC-22 的送出順序，結束後核對各單位順位與勝出組，再重啟伺服器重看

### Tests for User Story 1（先寫並確認失敗）

- [ ] T003 [P] [US1] 在 `tests/unit/fair-ranking/fair-ranking.test.js` 為 `rankFair` 寫測試（[contracts/fair-ranking.md](contracts/fair-ranking.md)；FR-001、FR-002、FR-003、FR-004、AC-21、AC-22）：(a) 契約的 V1～V7 測試向量逐一以 `assert.deepEqual` 比對輸出（V1 為 AC-21，V2～V4 為 AC-22，V5 只有一組，V6 單位順序取自陣列，V7 空輸入與全部無人送出）；(b) 輸入以 `Object.freeze` 深度凍結後呼叫不丟錯、不被修改；(c) 同一輸入呼叫兩次輸出相同；先以輸入 X 呼叫、再以輸入 Y 呼叫，Y 的結果與單獨呼叫 Y 相同（函式不保留任何狀態，跨活動不沿用勝出歷史，US1 情境 6）；(d) 不變式測試：以固定種子的偽隨機產生器（例如 mulberry32）產生 200 個情境，每個情境 1～10 組、1～20 個單位，各組以機率決定是否送出各單位，受理序號全域遞增，逐一檢查契約的四條不變式（每個單位的順位恰為 1..n 各一次、每筆送出恰出現一次、單位內輸出順序符合「先前單位拿到第 1 名的次數（由輸出本身重新統計）、`acceptSeq`」升序、每個有送出的單位恰有一位順位 1）（SC-001）
- [ ] T004 [P] [US1] 在 `tests/unit/results-export/results.test.js` 改寫「a mode without a ranking cannot close…」這個測試，拆成三個測試（FR-005、FR-006，research R9）：(a) 公平模式結束時同交易保存公平順位——以 fixtures 建立甲、乙兩組與兩個單題單位，甲組兩個單位都先受理（AC-21）；結束後 `results` 為：單位 1 甲 `final_rank` 1／`is_winner` 1、乙 2／0，單位 2 乙 1／1、甲 2／0，且 `submissions.accept_seq` 沒有改變；(b) 保存失敗整個回滾——結束前以 `db.exec('DROP TABLE results')` 讓結果寫入失敗，`transitionActivity` 丟出錯誤，活動仍為 `OPEN` 且 `closed_at` 為 `NULL`；(c) 未登錄的模式——直接呼叫 `saveFinalResults(db, activityId, 'UNKNOWN')` 丟出 409 `RANKING_UNAVAILABLE`。檔內其餘測試不動
- [ ] T005 [P] [US1] 建立 `tests/integration/fair-ranking/fair-ranking.test.js`（本檔由 US1～US3 依序擴充）：檔內定義與 `tests/integration/results-export/results-export.test.js` 相同做法的區域輔助函式（`makeTeacher`、`joinGroup`、`post`、`api`、`close`）。寫 US1 的 HTTP 測試：教師登入並建立活動，於準備中以 `app.db.prepare("UPDATE activities SET mode = 'FAIR' WHERE id = ?")` 設為公平模式（模式端點在 US2 才加入），以 fixtures 建立兩個單題單位，甲組與乙組加入並開啟；依序由甲、乙送出單位 1，再由甲、乙送出單位 2（AC-21）；教師結束回 200 且 `activity` 為 `{ mode: 'FAIR', status: 'CLOSED' }`；教師 `GET …/results` 與學生 `GET /api/student/results` 內容相同，單位 1 的 `entries` 為 `[甲組 rank 1 acceptedOrder 1 isWinner true, 乙組 rank 2 acceptedOrder 2 isWinner false]`，單位 2 為 `[乙組 rank 1 acceptedOrder 2 isWinner true, 甲組 rank 2 acceptedOrder 1 isWinner false]`（FR-002、FR-004、FR-006）；另有一場含無人作答單位的公平活動可結束且該單位 `noAnswer: true`，一場完全沒有送出的公平活動也可結束；以檔案型 SQLite 重啟後（沿用 `results-export.test.js` 的 `startServer` 做法）兩位學生與老師讀到的結果與重啟前相同（AC-22）

### Implementation for User Story 1

- [ ] T006 [US1] 在 `src/features/fair-ranking/fair-ranking.js` 實作並匯出同步純函式 `rankFair(units)`（[contracts/fair-ranking.md](contracts/fair-ranking.md)；FR-001、FR-002、FR-003、FR-004）：以 `Map<groupId, number>` 記錄勝出次數（沒有紀錄視為 0）；依輸入順序逐單位把 `submissions` 複製後依「勝出次數少→多，相同則 `acceptSeq` 小→大」排序，給 `finalRank` 1、2、3…；該單位至少一筆送出時，第 1 名的組勝出次數加一；沒有送出的單位不產生輸出；回傳 `{ submissionId, unitId, finalRank }[]`（依單位順序串接，單位內依順位）。不修改輸入、不使用 `Date` 或亂數、不 `await`
- [ ] T007 [US1] 在 `src/features/results-export/ranking.js`（FR-005、FR-006）匯入 `rankFair`，把 `RANKERS` 改為 `Object.freeze({ SPEED: rankSpeed, FAIR: rankFair })`，並移除「SF-05 adds FAIR… a fair activity cannot be closed」的註解；`saveFinalResults` 對未登錄模式的 409 `RANKING_UNAVAILABLE` 防護保留（research R9）
- [ ] T008 [US1] 執行 `node --test 'tests/unit/fair-ranking/*.test.js' 'tests/unit/results-export/*.test.js' 'tests/integration/fair-ranking/*.test.js' 'tests/integration/results-export/*.test.js' 'tests/integration/realtime-buzzer/*.test.js'`，確認新測試通過，SF-03、SF-04 的既有行為不受影響

**Checkpoint**: 公平模式活動可結束並保存公平順位；US1 可獨立驗收（AC-21、AC-22）

---

## Phase 4: User Story 2 - 準備中選擇模式，開啟後鎖定，學生看得到模式與規則 (Priority: P1，#19)

**Goal**: 老師在準備中選擇或改選模式，開啟後鎖定；老師與已加入的學生看到模式與規則並即時更新；學生仍拿不到其他組資訊（FR-007～FR-012）

**Independent Test**: 準備中來回改選並確認老師與學生畫面同步；開啟後再改選被拒絕；學生與未登入者改選被拒絕

### Tests for User Story 2（先寫並確認失敗）

- [ ] T009 [P] [US2] 在 `tests/unit/fair-ranking/modes.test.js` 為 `selectMode` 寫測試（[contracts/http-api.md](contracts/http-api.md)、research R4）：(a) 新活動為 `SPEED`；準備中改為 `FAIR`、改回 `SPEED`，選回目前的模式成功且模式不變，回傳更新後的活動（`id`、`joinCode`、`status`、`mode`、`createdAt`）；(b) 活動為 `OPEN` 或 `CLOSED` 時丟出 409 `INVALID_PHASE` 且模式不變，包含選回相同模式（FR-008）；(c) 模式值為 `'speed'`、`'FAIR '`、`''`、`null`、`undefined`、`123` 時丟出 400 `INVALID_MODE` 且模式不變（FR-009）；(d) 活動不存在丟出 404 `ACTIVITY_NOT_FOUND`；(e) 先後順序：`selectMode` 之後再以 `transitionActivity` 開啟，活動以新模式開啟，之後 `selectMode` 一律 409；先開啟再 `selectMode` 也是 409，模式維持開啟當時的值
- [ ] T010 [US2] 擴充 `tests/integration/fair-ranking/fair-ranking.test.js`，加入模式端點的 HTTP 測試：(a) 教師 `POST activities/:id/mode { mode: 'FAIR' }` 回 200 與 `{ activity }`，重複選同一模式也回 200，改回 `SPEED` 成功；(b) 學生工作階段（把學生的 `buzzer_group` Cookie 複製到教師端 client，做法同 `results-export.test.js` 的 `withCookie`）與未登入者回 401 `TEACHER_REQUIRED`、缺 CSRF 回 403 `INVALID_CSRF`、錯誤 Origin 回 403 `INVALID_ORIGIN`，每種情況模式皆不變（FR-009、AC-16）；(c) body 為空、`mode` 不合法或帶多餘欄位回 400 `INVALID_MODE`（FR-009），活動不存在回 404 `ACTIVITY_NOT_FOUND`；(d) 開啟後與結束後再改選（含選回相同模式）都回 409 `INVALID_PHASE`，資料庫中 `activities.mode` 仍是開啟當時的值（AC-23）；(e) 同步：兩組學生加入後，先開啟學生與教師的 SSE 串流（以檔內的 `snapshots` 輔助函式，做法同 `tests/integration/realtime-buzzer/realtime-buzzer.test.js`），再改選模式，2 秒內兩個串流都收到 `activity.mode` 為新值的快照，`GET …/live` 與 `GET /api/student/activity` 也反映；改選之後才加入的學生，`POST /api/student/join` 與 `GET /api/student/session` 回應的 `activity.mode` 已是最新模式（FR-011、SC-003）；(f) 並行：重複 20 次，每次在新活動上以 `Promise.all` 同時送出「改選為 `FAIR`」與「開啟活動」——若改選回 200，活動以 `FAIR` 開啟；若改選回 409，活動以 `SPEED` 開啟；開啟後再改選一律 409；另在準備中同時送出改選為 `FAIR` 與 `SPEED` 兩個請求，兩者都回 200，最後資料庫中的模式是兩者之一且教師與學生快照一致（AC-23）；(g) 隱私與監看：公平模式搶答中，甲組學生在乙組送出前後取得的 `GET /api/student/activity` 與 SSE 快照不含乙組的名稱、答案、數量、順位、勝出次數或勝出者，且快照欄位與速度模式完全相同（`activity` 只有 `id`、`mode`、`status`，沒有任何勝出次數或順位欄位）（AC-09、SC-005）；教師 `GET …/live` 的每個單位 `winnerGroupId` 為 `null`、`submissions` 依 `acceptSeq` 排列（FR-012），速度模式則仍為最先受理的組

### Implementation for User Story 2

- [ ] T011 [US2] 在 `src/features/fair-ranking/modes.js`（FR-007、FR-008、FR-009）實作 `MODES = Object.freeze(['SPEED', 'FAIR'])` 與 `selectMode({ db }, activityId, mode)`：`MODES` 不含 `mode`（含非字串）→ `badRequest('INVALID_MODE', '請選擇速度模式或公平模式。')`；`withTransaction(db, …)` 內以 `getActivity(db, activityId)` 取得活動（不存在為 404），`status !== 'PREPARING'` → `conflict('INVALID_PHASE', '活動開啟後模式已鎖定，無法更改。')`，否則 `UPDATE activities SET mode = ? WHERE id = ?` 並回傳 `getActivity(db, activityId)`；回呼為同步函式，不 `await`
- [ ] T012 [US2] 在 `src/features/fair-ranking/router.js` 新增 `POST /teacher/activities/:activityId/mode`（FR-007、FR-009），中介層順序為 `requireTeacher(deps)`、`requireMutation(deps, 'teacher')`（本路由掛在 `app.js` 全域 `express.json` 之後，`req.body` 已解析，不另設 `json()`）：body 不是「只含 `mode` 欄位的物件」時丟出 `badRequest('INVALID_MODE', …)`；否則 `res.json({ activity: selectMode(deps, req.params.activityId, req.body.mode) })`
- [ ] T013 [P] [US2] 建立 `public/teacher/mode-select.js`，並在 `public/teacher/index.html` 的 `#teacher-groups` 之後（`#sheets-import` 之前）加入 `<section id="mode-select" hidden></section>`、於 `/teacher/activity-groups.js` 之前載入模組。單選群組使用 `fieldset` 與 `legend`「活動模式」，兩個 `radio`（`name="activity-mode"`，標籤「速度模式」「公平模式」），下方顯示目前選中模式的 `renderModeRule` 與固定提示「開啟活動後，模式就會鎖定，無法更改。」。行為：收到 `teacher-activity`（`null` 時隱藏並清空）與 `teacher-activity-phase` 時更新；`PREPARING` 可操作，`OPEN` 唯讀並顯示「活動已開啟，模式已鎖定。」，`CLOSED` 隱藏（由結果頁顯示）；選項改變時以 `apiFetch` 送 `POST /api/teacher/activities/${id}/mode`，送出中停用選項並顯示「正在更新模式…」，成功後依回應更新並顯示「已改為公平模式。」，失敗以 `role="alert"` 顯示 `error.message` 並還原成最後已知的模式；全部文字只經 `h()`／`setText()`；只用鍵盤即可操作，鎖定與錯誤以文字表達；必要時在 `public/css/base.css` 補 `.mode-rule` 與單選群組的間距（FR-007、FR-008、FR-011，constitution VIII）
- [ ] T014 [P] [US2] 建立 `public/student/mode-info.js`，並在 `public/student/index.html` 的 `#student-buzzer` 之前加入 `<section id="student-mode" hidden></section>`、於 `/student/activity-groups.js` 之前載入模組：收到 `student-activity`（`null` 時隱藏）與 `student-activity-phase` 時，在 `PREPARING`、`OPEN` 顯示標題「本場活動模式」、`modeLabel[mode]` 與 `renderModeRule(mode)`，`CLOSED` 時隱藏（結果頁會顯示規則）；內容只有固定文字（FR-010、FR-011）
- [ ] T015 [P] [US2] 在 `public/student/realtime-buzzer.js` 的 `updateSnapshot`（FR-011），把 `phaseChanged` 改為 `state.activity.status !== snapshot.activity.status || state.activity.mode !== snapshot.activity.mode`，讓學生端 `student-activity-phase` 在模式改變時也派發（research R6；`student/activity-groups.js` 的 `syncLeavePhase` 只讀 `id`、`status`，不受影響；`announcedClose` 邏輯不動）
- [ ] T016 [US2] 執行 `node --test 'tests/unit/fair-ranking/*.test.js' 'tests/integration/fair-ranking/*.test.js' 'tests/integration/realtime-buzzer/*.test.js' 'tests/integration/activity-groups/*.test.js'`，確認 US2 測試通過，SF-01、SF-03 不受影響

**Checkpoint**: US2 的自動化部分可獨立驗收（AC-23 的選擇與鎖定、FR-010～FR-012）；畫面行為於 Polish 以瀏覽器驗證

---

## Phase 5: User Story 3 - 結果頁、Sheets 寫回與 CSV 一致並標示模式 (Priority: P2，#19)

**Goal**: 公平模式活動結束後，結果頁、寫回預覽與 CSV 使用同一份結果並標示模式，分開呈現受理順序與最終順位，重啟後不變；速度模式行為不變（FR-013～FR-017）

**Independent Test**: AC-21 的活動結束後，逐一比對結果頁、寫回預覽與 CSV 的勝出組、答案、順位與模式，再重啟伺服器重新比對；另以速度模式確認 SF-04 行為不變

### Tests for User Story 3（先寫並確認失敗）

- [ ] T017 [US3] 擴充 `tests/integration/fair-ranking/fair-ranking.test.js`，加入端到端與一致性測試，這次公平模式一律以 `POST …/mode` 端點選擇：(a) AC-21 全流程——準備中選公平、開啟、甲組兩個單位都先送出、結束；教師與學生 `results` 的 `activity.mode` 為 `FAIR`，單位 2 依序為乙組（rank 1、acceptedOrder 2、isWinner true）與甲組（rank 2、acceptedOrder 1、isWinner false）（AC-23）；(b) CSV：`GET …/results.csv` 的 `mode` 欄全為 `FAIR`，單位 2 乙組那列 `rank=1`、`accepted_order=2`、`is_winner=true`，甲組 `rank=2`、`accepted_order=1`、`is_winner=false`，列依單位順序與順位排序（FR-013、FR-015、AC-19）；(c) 寫回預覽：`startTestApp({ sheetsGateway })` 注入假 gateway（沿用 `tests/unit/results-export/sheets-export.test.js` 的測試替身做法），`POST …/sheets-export/preview` 中單位 2 的 `content` 是乙組的答案、單位 1 是甲組的答案（FR-013、FR-015、AC-23、AC-17）；(d) 重啟後（檔案型 SQLite，沿用 US1 的 `startServer` 做法）結果、CSV 與預覽內容與重啟前完全相同（FR-016、AC-22）；結果頁、寫回內容與 CSV 的勝出組、答案、順位與模式在 (a)～(d) 全部逐一比對一致（SC-004）；(e) 回歸：同樣流程在速度模式下單位 2 由甲組勝出，結果、CSV 與預覽符合 SF-04 的行為（FR-017、SC-006）；(f) 公平模式活動結束前，學生 `GET /api/student/results` 回 409 `INVALID_PHASE` 且不含其他組資料，結束後只讀得到自己活動的結果（SC-005）

### Implementation for User Story 3

- [ ] T018 [P] [US3] 在 `public/js/results-view.js` 自 `/js/mode-rules.js` 匯入 `modeLabel`、`renderModeRule`，並以 `export { modeLabel }` 轉出（教師與學生結果模組既有的 `import { modeLabel, renderResults } from '/js/results-view.js'` 不需修改）；`renderResults(view, options)` 回傳陣列的第一個元素改為 `renderModeRule(view.activity.mode)`，其後才是各單位的 section；更新檔頭註解與 JSDoc 的回傳說明。兩種模式都顯示規則說明；表格欄位「最終順位」「受理順序」維持不變，不新增勝出次數欄（FR-010、FR-014，Clarification）
- [ ] T019 [P] [US3] 在 `public/teacher/results-export.js` 讓寫回預覽摘要（`previewSummary`）與最近一次寫回紀錄摘要（`recordSummary`）的文字開頭標示活動模式，例如「公平模式・共 3 題：可寫入 3、…」：載入結果時把 `view.activity.mode` 存入模組狀態，兩處文字以 `modeLabel` 組成；其餘寫回流程不變（FR-013）
- [ ] T020 [US3] 執行 `node --test 'tests/integration/fair-ranking/*.test.js' 'tests/integration/results-export/*.test.js' 'tests/unit/results-export/*.test.js'`，確認 US3 測試通過，SF-04 的速度模式行為不變

**Checkpoint**: 三個 user story 都可獨立運作

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T021 更新 SF-04 文件中因 SF-05 而過時的敘述：`specs/004-results-export/acceptance.md`（「公平模式在 SF-05 完成前無法結束」改為公平模式由 `specs/005-fair-ranking` 提供）、`specs/004-results-export/quickstart.md`（`results.test.js` 的說明移除「公平模式拒絕」，改為「結束時保存、不可修改、結果檢視」）、`specs/004-results-export/contracts/http-api.md`（409 `RANKING_UNAVAILABLE` 改為「活動模式沒有登錄順位計算（目前所有模式都有，不會發生）」）；`spec.md`、`research.md`、`tasks.md` 是當時的紀錄，不改
- [ ] T022 執行 `npm test`，全部通過
- [ ] T023 以 `npm start`（沒有真實試算表時以測試替身 gateway 啟動）搭配 headless Chrome（DevTools Protocol，做法同 SF-04）走一次 quickstart.md 的本機流程，並把截圖存到 `specs/005-fair-ranking/evidence/`：準備中改選與開啟後鎖定、學生端模式與規則即時更新、公平模式搶答中監看表的「勝出：結束時計算」、公平模式結果頁（規則與範例、最終順位與受理順序兩欄、第二單位乙組勝出）、寫回預覽標示模式、只用鍵盤（Tab、方向鍵）操作單選群組、沒有頁面錯誤；記錄「結束後到結果頁出現」與「改選後到學生畫面更新」的耗時（目標 2 秒內，SC-002、SC-003）
- [ ] T024 建立 `specs/005-fair-ranking/acceptance.md`：列出 AC-21、AC-22、AC-23 對應的自動化測試與畫面證據（截圖路徑），SC-003 的「直接修改資料」引用既有的 `tests/unit/base-schema.test.js`（「mode can change while PREPARING and is locked once OPEN」），以及待真實雲端試算表完成的項目（公平模式寫回、兩種模式共通情境，屬整合驗收 #20），明確標為待驗證
- [ ] T025 更新 `README.md`：「已實作」段落加入公平排序（SF-05）；分工表 SF-05 列填入負責人 `45678XYZ`、Issue #17 與驗收紀錄連結（PR 欄於開啟 PR 後補上真實連結）；SF-04 列的審閱者填入 tom1030507 對 #29 的 approve review 連結（以 `gh api` 取得）
- [ ] T026 依 `after_implement` hook 執行 `/speckit-plantuml-sync`，產生 `specs/005-fair-ranking/diagram-sync.md` 並更新圖表；若 `results-export/ranking.js` 匯入 `fair-ranking/fair-ranking.js` 與 `diagrams/system-component.puml` 的 SF-05／SF-04 依賴方向不同，一併修正基準圖

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup（Phase 1）**、**Foundational（Phase 2）**：彼此不依賴；US2、US3 需要 T001、T002
- **US1（Phase 3）**：只依賴 SF-04 既有的 `saveFinalResults`；可在 T002 之前開始
- **US2（Phase 4）**：依賴 T001（router 骨架）與 T002（說明文字）；不依賴 US1，但在 US1 完成前選了公平模式的活動無法結束
- **US3（Phase 5）**：依賴 US1（T006、T007）、US2 的模式端點（T011、T012）與 T002
- **Polish（Phase 6）**：依賴所有 user story

### Within Each Phase

- 測試先寫並確認失敗，再實作
- `fair-ranking.js`（T006）→ `ranking.js` 註冊（T007）
- `modes.js`（T011）→ `router.js` 端點（T012）→ 前端模組
- `tests/integration/fair-ranking/fair-ranking.test.js` 由 T005、T010、T017 依序擴充，同一檔案的任務依序進行

### Parallel Opportunities

- T001、T002 可平行
- T003、T004、T005 可平行（不同測試檔）；T009 可與它們平行
- T013、T014、T015 可平行（不同前端檔案）
- T018、T019 可平行

---

## Parallel Example: User Story 2

```bash
# 先寫測試：
Task: "T009 selectMode 單元測試 in tests/unit/fair-ranking/modes.test.js"
Task: "T010 模式端點 HTTP 測試 in tests/integration/fair-ranking/fair-ranking.test.js"（接在 T005 之後）

# 再平行實作互不依賴的前端：
Task: "T013 教師模式選擇 public/teacher/mode-select.js"
Task: "T014 學生模式與規則 public/student/mode-info.js"
Task: "T015 學生端模式改變時派發階段事件 public/student/realtime-buzzer.js"
```

---

## Implementation Strategy

### MVP First（User Story 1 + 2）

1. Phase 1 Setup、Phase 2 Foundational
2. Phase 3 US1：公平模式可結束並保存公平順位（先獨立驗收 AC-21、AC-22）
3. Phase 4 US2：老師才真正能選擇並使用公平模式（兩個 P1 一起構成可用的 MVP）
4. **STOP and VALIDATE**：AC-23 的選擇與鎖定

### Incremental Delivery

1. Setup＋Foundational → 前端有共用的模式說明
2. US1 → 公平順位計算與保存（資料庫層級可驗收）
3. US2 → 準備中選擇、開啟後鎖定、學生看得到規則
4. US3 → 結果頁、寫回與 CSV 一致並標示模式
5. Polish → 完整測試、瀏覽器檢查、驗收紀錄、圖表同步

---

## Notes

- [P] 任務 = 不同檔案、沒有未完成的依賴
- 每完成一組相關任務就以 `/commit-claude` 格式提交
- 不修改根目錄 `spec.md`；跨子功能的修改（`results-export/ranking.js`、`app.js`、`student/realtime-buzzer.js`、`results-view.js`、`teacher/results-export.js`、`results.test.js`、SF-04 文件）在 PR 中請負責人確認
- 公平模式的真實 Google Sheets 驗收屬於整合驗收（#20），本功能的驗收紀錄只記錄測試替身的結果並列出待驗證項目
