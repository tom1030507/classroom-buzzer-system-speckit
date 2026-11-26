# SF-01 實作計畫

規格見 [SF-01](spec.md)。採 Express router、Node 內建 scrypt、SQLite 與原生 JavaScript。

- [元件圖](../../diagrams/001-activity-groups-component.puml) 描述 CLI、雙角色頁面、router 與共用授權介面。
- [類別圖](../../diagrams/001-activity-groups-class.puml) 描述教師密碼雜湊以及活動、組別與工作階段關聯。
- [循序圖](../../diagrams/001-activity-groups-sequence.puml) 描述 CSRF 啟動、驗證、重連和確認退出。

首次登入前以本機 CLI 建立 scrypt 雜湊。教師與學生分別使用角色專用的 HttpOnly Cookie，資料庫只保存 Cookie 的摘要。準備登入或加入時，由同源 GET 發放短期 Cookie 與其衍生的 CSRF token。變更請求以相同來源與對應 Cookie 衍生值驗證 `X-CSRF-Token`。

`POST /api/teacher/login`、`POST /api/teacher/logout`、`GET /api/teacher/session` 處理教師工作階段。`POST /api/teacher/activities` 在同一交易內確認沒有未結束活動後建立預設速度模式活動（否則 `409 ACTIVITY_UNFINISHED`），加入碼以 `crypto.randomInt` 從六碼指定字元集產生（AC-24）；`GET /api/teacher/activities/current` 載入最近一場及其他未結束的活動，`GET /api/teacher/activities/:activityId` 回傳指定活動與教師可見名單。
`GET /api/student/session` 與 `POST /api/student/join` 只回傳本人組別以及活動 ID、模式和階段。`requireTeacher`、`requireGroupSession` 與 `requireMutation` 供後續功能共用。新增組別與核發工作階段由同一筆交易完成。同一瀏覽器在工作階段 Cookie 送達前可重試原加入請求；工作階段值由伺服器 HMAC 種子及瀏覽器原 Cookie 推導。

## 技術背景

- Node.js 24 以上、Express 5 與原生 JavaScript；CI 以 `.nvmrc` 的 Node.js 26 執行 `node:test`。
- SQLite 儲存活動、組別、教師密碼的雜湊及工作階段摘要，伺服器只監聽 localhost。未登入與已登入的 CSRF token 各與對應角色的 Cookie 綁定。
- `POST /api/student/leave` 在交易中重新讀取組別工作階段及活動階段。組別刪除時，以資料庫外鍵同步撤銷該組工作階段；收到成功回覆後重新顯示加入表單。若回覆遺失，學生頁重新取得工作階段以判定結果。

## 實作與驗證入口

- `src/features/activity-groups/{password,sessions,activities,router}.js` 處理 SF-01 後端；`scripts/setup-teacher.js` 提供本機設定；`public/{student,teacher}/activity-groups.js` 提供操作介面。
- [設計決策](research.md)、[資料模型](data-model.md)、[API 契約](contracts/activity-groups.md)、[驗證方式](quickstart.md)與 [任務](tasks.md)對照圖表與實作。

## Constitution Check

沿用 localhost、安全標頭、錯誤格式及交易 helper。沒有額外相依套件；根規格及基礎 migration 不變。權限、Cookie、組名去重、原子加入、交易內退出與重啟驗證由 HTTP 測試覆蓋。

AC-24（#32）的三條規則依根規格 v1.1 辦理，根規格變更以獨立 PR 進行（Constitution 原則 I）；本功能只改 `activities.js` 與教師頁訊息，不新增 migration（見 [研究紀錄](research.md)）。
