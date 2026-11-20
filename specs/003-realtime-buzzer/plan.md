# SF-03 實作計畫

**分支** `feat/003-realtime-buzzer` · **範圍** [SF-03 規格](spec.md) · **工作項目** [#9](https://github.com/tom1030507/classroom-buzzer-system-speckit/issues/9)

## 摘要

教師以 HTTP 控制活動，學生以 HTTP 送出整個作答單位。兩種工作階段各自透過 SSE 接收可見的活動快照。SQLite 同步交易為送出、去重及結束提供同一受理順序。（FR-03～FR-05、FR-08）

## 技術脈絡

- **執行環境** 採 Node.js 24 以上、Express `5.3.0`、內建 `node:sqlite`、`node:crypto` 與 `node:test`。瀏覽器使用原生 HTML、CSS、JavaScript ES modules 與 `EventSource`。沿用 `package-lock.json`，這個功能沒有新增相依套件。
- **儲存** SQLite 在本機持久保存活動階段、單位、受理序號、答案原文與不透明受理識別。用 `withTransaction` 的同步 `BEGIN IMMEDIATE` 序列化送出和結束；題組發生寫入錯誤時，整筆回滾。[交易與資料模型](data-model.md)
- **部署及效能** HTTP 服務只綁 loopback。在 1 位教師、10 組學生、20 題的情境驗證 2 秒內同步階段及回應一般送出。串流每 250 毫秒從 SQLite 比對個別工作階段快照；快照未變更時每隔至少 15 秒送一次 SSE 註解心跳。[實作取捨](research.md)
- **介面** 掛載教師控制與監看路由、學生快照與送出路由。資料從伺服器授權的 Cookie 建立；Origin 與 CSRF 由共用工作階段中介層檢查。教師版面提供匯入版號檢查和固定的監看表格節點，學生版面以本組受理資料和文字連線狀態呈現。[HTTP 與 SSE 契約](contracts/http-sse.md)
- **驗證** 內建測試以固定伺服器時鐘、記憶體或檔案型 SQLite，以及實際 loopback HTTP／SSE 檢驗驗收條件。瀏覽器驗證使用真實本機應用及 Sheets 測試替身。真實 Google Sheets 的課程端驗收須使用具備授權的副本。[快速驗證](quickstart.md) · [驗收紀錄](acceptance.md)

## 設計與實作位置

1. **階段與同步（T001）**。`src/features/realtime-buzzer/{router,state,events}.js` 驗證合法轉移、開啟時的已確認匯入版本與結束確認，並在建立或重連串流時送出完整快照。教師與學生由 SF-01 工作階段授權，作答單位由 SF-02 提供。[元件圖](../../diagrams/003-realtime-buzzer-component.puml) · [結束循序圖](../../diagrams/003-realtime-buzzer-sequence-close.puml)
2. **受理與重試（T002）**。`src/features/realtime-buzzer/submissions.js` 在交易內驗證、去重、分配下一個序號及儲存全部答案，`src/db/migrations/003-01-submission-receipts.sql` 產生可持久保存的個人受理識別。活動結束後先依階段拒絕 POST，保留已受理資料供讀取。結束交易內的結果保存接點由 SF-04 #14 實作。[類別圖](../../diagrams/003-realtime-buzzer-class.puml) · [送出循序圖](../../diagrams/003-realtime-buzzer-sequence-submit.puml)
3. **授權投影與頁面（T003）**。`src/features/realtime-buzzer/snapshots.js` 分別建立教師監看與學生快照。`public/js/activity-events.js` 處理連線與重連，教師與學生的 `realtime-buzzer.js` 更新各自版面。`public/teacher/sheets-import.js` 依教師快照更新同活動的確認匯入，保留老師仍在編輯的預覽草稿。
4. **整合與取證（T004）**。以 `tests/unit/realtime-buzzer/submissions.test.js` 驗證交易不變量，以 `tests/integration/realtime-buzzer/realtime-buzzer.test.js` 驗證 HTTP、SSE、時限與重啟。以 PlantUML CLI 產生對應的 PNG，依[圖表核對紀錄](diagram-sync.md)對應程式。[任務與證據](tasks.md)

## Constitution Check

- **I、VII**。以根規格及既有技術棧為基準，任務在 SF-03 範圍內追溯至 FR／AC。將最終結果保存接到結束交易屬 SF-04 #14，公平順位由 SF-05 擴充。
- **II、VIII**。後端角色驗證、Origin、CSRF 與個別投影防止越權。學生頁面和教師監看以純文字呈現組名與答案，具備欄位標籤、鍵盤操作與狀態文字。瀏覽器以實際受理回覆或快照中的本組受理紀錄確認成功。
- **III**。`OPEN` 期間的有效重送回傳第一筆紀錄。`CLOSED` 拒絕任何新的送出請求與重送，透過快照保留已受理紀錄可讀性。依根規格 §3、FR-04 及 AC-10 的階段邊界適用去重規則。
- **IV、V**。SF-03 使用 SF-02 提供的持久映射。測試使用特製資料或明示替身，真實課程試算表驗收另依授權與證據紀錄。各 AC 對應[驗收紀錄](acceptance.md)；合併關卡為完整 `npm test`。
- **VI**。元件、類別、送出及結束循序圖和同名 PNG 已列於任務及核對紀錄。
