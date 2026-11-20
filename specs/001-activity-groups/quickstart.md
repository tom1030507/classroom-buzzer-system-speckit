# SF-01 驗證方式

1. 執行 `npm ci`、`npm run setup:teacher` 和 `npm start`。在 `/teacher/` 以本機教師密碼登入，建立兩場活動，記下各自的加入碼。
2. 用兩個獨立的瀏覽器工作階段開啟 `/student/`，加入第一場，並以不同組名登記。刷新學生頁應保留原組名。
3. 在第一個學生工作階段點選「退出目前活動」並確認。教師重新載入第一場的組別，應只看到第二組；第一組可直接輸入第二場的加入碼。驗證原 Cookie 無法恢復已退出的組別。
4. 執行 `node --test --test-reporter=spec tests/integration/activity-groups/activity-groups.test.js`。自動測試另外驗證伺服器重啟、Origin／CSRF、舊畫面退出及其他組別資料隔離。
