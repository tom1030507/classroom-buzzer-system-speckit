# SF-01 驗證方式

1. 執行 `npm ci`、`npm run setup:teacher` 和 `npm start`。在 `/teacher/` 以本機教師密碼登入，建立一場活動，記下六碼加入碼。再按一次「建立新活動」，應顯示已有未結束的活動（AC-24）。
2. 用兩個獨立的瀏覽器工作階段開啟 `/student/`，加入活動，並以不同組名登記；超過 30 個字元的組名應被拒絕。刷新學生頁應保留原組名。
3. 在第一個學生工作階段點選「退出目前活動」並確認。教師重新載入組別，應只看到第二組；第一組可用同一加入碼改名重新加入。驗證原 Cookie 無法恢復已退出的組別。
4. 執行 `node --test --test-reporter=spec tests/integration/activity-groups/activity-groups.test.js`。自動測試另外驗證伺服器重啟、Origin／CSRF、舊畫面退出及其他組別資料隔離。
