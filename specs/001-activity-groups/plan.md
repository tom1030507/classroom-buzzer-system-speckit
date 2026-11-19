# SF-01 實作計畫

規格見 [SF-01](spec.md)。採 Express router、Node 內建 scrypt、SQLite 與原生 JavaScript。

- [元件圖](../../diagrams/001-activity-groups-component.puml) 描述 CLI、雙角色頁面、router 與共用授權介面。
- [類別圖](../../diagrams/001-activity-groups-class.puml) 描述教師密碼雜湊以及活動、組別與工作階段關聯。
- [循序圖](../../diagrams/001-activity-groups-sequence.puml) 描述 CSRF 啟動、驗證和重連。

首次登入前以本機 CLI 建立 scrypt 雜湊。教師與學生分別使用角色專用的 HttpOnly Cookie，資料庫只保存 Cookie 的摘要。準備登入或加入時，由同源 GET 發放短期 Cookie 與其衍生的 CSRF token。變更請求以相同來源與對應 Cookie 衍生值驗證 `X-CSRF-Token`。

`POST /api/teacher/login`、`POST /api/teacher/logout`、`GET /api/teacher/session` 處理教師工作階段。`POST /api/teacher/activities` 建立預設速度模式活動，`GET /api/teacher/activities/current` 載入最近一場及其他未結束的活動，`GET /api/teacher/activities/:activityId` 回傳指定活動與教師可見名單。
`GET /api/student/session` 與 `POST /api/student/join` 只回傳本人組別以及活動 ID、模式和階段。`requireTeacher`、`requireGroupSession` 與 `requireMutation` 供後續功能共用。新增組別與核發工作階段由同一筆交易完成。同一瀏覽器在工作階段 Cookie 送達前可重試原加入請求；工作階段值由伺服器 HMAC 種子及瀏覽器原 Cookie 推導。

## Constitution Check

沿用 localhost、安全標頭、錯誤格式及交易 helper。沒有額外相依套件；根規格及基礎 migration 不變。權限、Cookie、組名去重、原子加入與重啟驗證由 HTTP 測試覆蓋。
