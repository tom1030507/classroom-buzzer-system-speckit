# SF-01 圖表同步紀錄

核對日期為 2026-11-19。核對本功能 PR 的實作，基底為 `56cca75`。

| 圖表 | 核對項目 | 程式位置 | 狀態 |
| --- | --- | --- | --- |
| Component | CLI、頁面、角色驗證與交易 | `scripts/setup-teacher.js`、`src/features/activity-groups/router.js`、`activities.js` | match |
| Class | 密碼雜湊欄位、教師工作階段期限、每組最多一個工作階段、加入重試的本機種子 | `src/db/migrations/001-*.sql` | match |
| Sequence | 工作階段與 CSRF、建立活動、加入、重連及準備中的確認退出 | `sessions.js`、`router.js`、`activities.js` | match |

以 `npm run diagrams -- 'diagrams/001-*.puml'` 產生三張 PNG。

2026-11-20 依 #24 審查更新循序圖。退出路徑沿用既有元件及組別外鍵關係。使用 `npm run diagrams -- diagrams/001-activity-groups-sequence.puml` 重新產生循序圖。

2026-11-27 依 #32（AC-24）更新類別圖與循序圖：加入碼六碼、組名 1～30 字元、建立活動時在同一交易檢查沒有未結束活動（`activities.js` 的 `createActivity`、`joinActivity`），狀態 updated；元件圖沒有新增元件或依賴，狀態 match。共用資料模型與主流程的系統基準圖（`system-class`、`system-sequence`）同步補上相同限制。以 `npm run diagrams -- diagrams/001-activity-groups-class.puml diagrams/001-activity-groups-sequence.puml diagrams/system-class.puml diagrams/system-sequence.puml` 重新產生 4 張 PNG。
