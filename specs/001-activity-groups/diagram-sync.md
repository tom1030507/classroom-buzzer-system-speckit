# SF-01 圖表同步紀錄

核對日期為 2026-11-19。核對本功能 PR 的實作，基底為 `56cca75`。

| 圖表 | 核對項目 | 程式位置 | 狀態 |
| --- | --- | --- | --- |
| Component | CLI、頁面、角色驗證與交易 | `scripts/setup-teacher.js`、`src/features/activity-groups/router.js`、`activities.js` | match |
| Class | 密碼雜湊欄位、教師工作階段期限、每組最多一個工作階段、加入重試的本機種子 | `src/db/migrations/001-*.sql` | match |
| Sequence | 工作階段與 CSRF、建立活動、加入、重連及準備中的確認退出 | `sessions.js`、`router.js`、`activities.js` | match |

以 `npm run diagrams -- 'diagrams/001-*.puml'` 產生三張 PNG。

2026-11-20 依 #24 審查更新循序圖。退出路徑沿用既有元件及組別外鍵關係。使用 `npm run diagrams -- diagrams/001-activity-groups-sequence.puml` 重新產生循序圖。
