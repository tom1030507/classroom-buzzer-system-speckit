# SF-05 研究與設計決策

對應 [plan.md](plan.md) 的 Phase 0。所有決策都以 [spec.md](spec.md)、根目錄 `spec.md` 與 constitution 為準，
並沿用 SF-01～SF-04 已建立的程式慣例。Technical Context 沒有待釐清項目。

## R1. 公平順位在結束交易內以同步純函式計算

- **Decision**：`rankFair(units)` 依 `units.position` 的順序逐單位處理；以 `Map<groupId, 勝出次數>`（從 0 起）記錄各組
  此前的勝出次數。每個單位把送出依「勝出次數少→多、`acceptSeq` 小→大」排序，給予 1、2、3… 的最終順位，
  第 1 名的組勝出次數加一。沒有任何送出的單位不改變 Map。
- **Rationale**：spec.md §4 與 constitution III 要求結束狀態與完整結果同交易保存；SF-04 的
  [`contracts/ranking.md`](../004-results-export/contracts/ranking.md) 已規定計算必須是同步純函式，
  `saveFinalResults` 已在結束交易內呼叫 `RANKERS[mode]`，SF-05 只需提供 `FAIR`。
  題組單位每組只有一筆受理，所以「題組只算一次勝出」自然成立。
- **Alternatives considered**：讀取時才計算（違反 §4 的同交易保存與不可變）；用 SQL 計算（每個單位的順序取決於
  前面單位的勝出結果，視窗函式無法單次表達，遞迴 CTE 難以閱讀與測試，也不符合純函式契約）。

## R2. `rankFair` 放在 `fair-ranking/`，由 `results-export/ranking.js` 匯入註冊

- **Decision**：函式放在 `src/features/fair-ranking/fair-ranking.js`；`results-export/ranking.js` 匯入它並把
  `RANKERS` 改為 `Object.freeze({ SPEED: rankSpeed, FAIR: rankFair })`。
- **Rationale**：每個子功能擁有自己的資料夾（`src/features/README.md`），SF-05 的邏輯與測試集中在
  `fair-ranking/`；依賴只有一個方向（`results-export` → `fair-ranking`，純函式、沒有循環）；`RANKERS` 維持明確的
  凍結常數，沒有隱性的全域狀態。單元測試直接匯入 `rankFair`。
- **Alternatives considered**：直接寫在 `results-export/ranking.js`（SF-05 的邏輯散在 SF-04 資料夾，歸屬與審查範圍不清）；
  可變的 `registerRanker`（匯入或掛載時才有副作用，單元測試必須先註冊，容易漏）。

## R3. 勝出次數不保存

- **Decision**：勝出次數只存在於 `rankFair` 的計算過程。`results` 仍只保存 `final_rank` 與 `is_winner`。
- **Rationale**：根目錄 spec.md FR-10 只要求保存模式、固定單位順序、受理順序與最終順位；勝出次數可由 `results`
  推得（某組在該單位之前 `is_winner = 1` 的單位數）。Clarification 已確認結果表不新增勝出次數欄。
- **Alternatives considered**：新增欄位或資料表保存各組勝出次數（重複資料，沒有使用者需求）。

## R4. 模式選擇端點

- **Decision**：`POST /api/teacher/activities/:activityId/mode`，body `{ "mode": "SPEED" | "FAIR" }`。
  中介層順序與 SF-03 的 `open`／`close` 相同：`requireTeacher` → `requireMutation`（Origin＋CSRF）→ JSON 解析（8 kB）
  → 驗證模式值（400）。`selectMode` 在 `withTransaction` 內 `getActivity`（404）、確認 `PREPARING`（409）、
  `UPDATE activities SET mode`，回傳更新後的活動。
- **Rationale**：檢查與更新在同一個 `BEGIN IMMEDIATE` 交易內，與 `transitionActivity`（開啟、結束）序列化，
  所以改選與開啟並行時只會有一種結果（AC-23）。基礎 schema 的 `activities_mode_locked_after_open` trigger 是最後防線。
  準備中選回目前的模式視為成功（沒有變化）；開啟後任何改選（含選回相同模式）一律 409。
- **Alternatives considered**：`PUT`／`PATCH`（目前所有變更端點都用 POST，沿用）；建立活動時帶 `mode`
  （Clarification 已否決，會改動 SF-01）；只靠資料庫 trigger（錯誤訊息不明確，會變成 500）。

## R5. 錯誤碼與檢查順序

- **Decision**：`INVALID_MODE`（400，模式缺漏、不是 `SPEED`／`FAIR`，或 body 有多餘欄位）；`INVALID_PHASE`（409，活動已開啟或已結束）；
  `ACTIVITY_NOT_FOUND`（404，沿用 `getActivity`）。授權錯誤由既有中介層回傳（401 `TEACHER_REQUIRED`、
  403 `INVALID_ORIGIN`／`INVALID_CSRF`）。
- **Rationale**：與 SF-03 結束活動一致：格式錯誤在進入交易前就以 400 回覆，階段與存在性在交易內判斷。
  學生工作階段呼叫教師端點時由 `requireTeacher` 回 401，不會到達 `selectMode`（AC-16）。

## R6. 模式變更靠既有 SSE 快照同步，不新增事件

- **Decision**：不新增任何 SSE 事件或端點。教師與學生快照都已含 `activity.mode`；SF-03 的串流每 250 毫秒以最新資料
  重組快照（學生串流每次都重新讀取組別工作階段），內容改變才推送，所以模式變更會自動送到各連線。
  前端：教師端 `teacher-activity-phase` 已以 `status:mode` 為鍵，模式改變時會派發；學生端 `student-activity-phase`
  目前只在 `status` 改變時派發，改為「`status` 或 `mode` 改變」（`public/student/realtime-buzzer.js` 的一行條件），
  `mode-info.js` 與既有的離開按鈕邏輯都只讀取事件中的欄位，不受影響。
- **Rationale**：不增加連線與伺服器輪詢；教師與學生用同一種鍵，行為一致；滿足 SC-003（2 秒內更新）。
- **Alternatives considered**：`mode-info.js` 自己開第二條 `EventSource`（每位學生的連線與 250 毫秒輪詢加倍）；
  定期呼叫 `GET /api/student/activity`（延遲較長、請求較多）；新增專用事件（需要改 SF-03 的伺服器端，沒有額外好處）。

## R7. 規則說明是前端固定常數

- **Decision**：`public/js/mode-rules.js` 匯出 `modeLabel`、`modeRule`（每種模式一組段落）與 `renderModeRule(mode)`。
  教師選擇區、學生模式區與結果頁共用。草稿如下，實作時可微調措辭但不得改變規則（spec.md §4）：
  - 速度模式：「每個單位由最先被伺服器受理的組別勝出。」
  - 公平模式：
    1. 「結束時依單位順序逐一計算順位：此前單位勝出次數較少的組優先，勝出次數相同時，先被伺服器受理的組優先。」
    2. 「每個單位的第 1 名勝出，該組的勝出次數加一次；題組只算一次，沒有人作答的單位不增加次數。」
    3. 「範例：某組已勝出 1 次、另一組勝出 0 次，即使前者先送出，這個單位仍由勝出 0 次的組排在前面。」
- **Rationale**：所有人看到的說明相同，沒有活動資料，不需要新端點，也沒有洩漏風險（FR-010、SC-005）；範例用「某組」
  等泛稱，避免與實際組名混淆（FR-014）；三處共用一個來源，不會彼此不一致；只以 `h()` 與文字節點呈現。
- **Alternatives considered**：由 API 回傳說明文字（多一個端點，內容卻是固定的）；各頁面各寫一份（容易不一致）。

## R8. 結果頁、寫回與 CSV 不改輸出邏輯

- **Decision**：`readResults`、`listWinningAnswers`、`buildResultsCsv` 不修改，只新增公平模式的測試。畫面上，結果頁顯示規則說明
  （兩種模式都顯示，滿足 FR-010 結束後也能看到規則），寫回預覽與紀錄的標題標示模式（FR-013）。
- **Rationale**：它們都只讀 `results` 與 `activities.mode`。`accepted_order` 以 `ROW_NUMBER() OVER (PARTITION BY unit_id
  ORDER BY accept_seq)` 計算、`rank` 取自 `final_rank`，結果頁本來就有「最終順位」與「受理順序」兩欄，結果依順位排序；
  寫回取 `is_winner = 1`；CSV 依單位順序與順位排序。SF-04 已有測試證明「最終順位與受理順序不同」時讀取正確（FR-025）。

## R9. 移除「公平模式無法結束」，保留未登錄模式的防護

- **Decision**：`RANKERS` 同時有 `SPEED` 與 `FAIR`。`saveFinalResults` 對沒有計算方式的模式仍丟 409 `RANKING_UNAVAILABLE`。
  SF-04 的測試「公平模式無法結束」改寫：公平模式結束時保存公平順位；未登錄的模式以直接呼叫驗證防護；
  「保存失敗時結束整個回滾」改以故意讓結果寫入失敗（移除 `results` 資料表）驗證。
- **Rationale**：結果一經保存不可修改，所以保留防護，避免日後新增模式卻忘了註冊時以錯誤規則保存。目前
  `activities.mode` 的 CHECK 只允許兩種模式，防護不會被一般流程觸發。

## R10. 不需要 migration 與補齊

- **Decision**：不新增 migration。`activities.mode` 與 `activities_mode_locked_after_open` 已在 `000-base-schema.sql`，
  `results` 格式相同。
- **Rationale**：SF-05 之前介面無法選擇公平模式，公平活動也無法結束，因此沒有「已結束但缺結果」的公平活動；
  `004-01` 的補齊只處理速度模式，維持不變。

## R11. 測試策略

- **Decision**：
  1. `rankFair` 單元測試：AC-21 與 AC-22 的固定向量（見 [contracts/fair-ranking.md](contracts/fair-ranking.md)）、
     輸入不被修改、相同輸入相同輸出、單位順序影響結果、沒有送出的單位與組別。
  2. 不變式測試：以固定種子產生許多隨機情境（最多 10 組 × 20 單位），檢查每個單位的順位為 1..n 的排列、輸出順序符合
     （此前勝出次數、受理序號）的排序（勝出次數由先前單位的第 1 名重新統計）、第 1 名即勝出者。
  3. `selectMode` 單元測試：準備中可改選與選回相同模式；開啟與結束後 409 且模式不變；模式值不合法 400；活動不存在 404；
     改選與開啟兩種先後順序的結果。
  4. 整合測試（HTTP）：學生、未登入、缺 CSRF、錯誤 Origin 都被拒絕；改選後教師與學生快照即時反映；
     AC-21 端到端（作答、結束、結果、寫回預覽、CSV）；重啟後不變；公平模式活動結束前學生看不到其他組資料。
- **Rationale**：constitution V 要求排序與公平順位先寫測試；SC-001 要求 10 組、20 題的情境。

## R12. 前端驗證方式

- **Decision**：專案沒有瀏覽器測試框架，沿用 SF-04 的做法：以 headless Chrome（DevTools Protocol）操作教師與兩組學生頁面，
  驗證改選與鎖定、學生端即時更新、公平模式結果頁（含規則範例與順位／受理順序兩欄）、單選群組只用鍵盤操作，
  並把截圖與結果記錄在 `acceptance.md`。
- **Rationale**：畫面行為（即時更新、鎖定後唯讀）無法只靠 API 測試證明；人工驗證需附證據（constitution V）。
