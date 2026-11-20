# SF-02 驗證方式

1. 執行 `npm ci`、`npm run setup:teacher` 和 `npm start`。依 [README 的服務帳戶設定](../../README.md#google-sheets-服務帳戶)準備憑證，並共用雲端試算表副本給服務帳戶。
2. 在兩張工作表填入兩個單題與三個同代號的題組標記。教師於 `/teacher/` 登入，建立活動，輸入雲端網址或 ID，選表排序後預覽。確認顯示五題三單位及原格位（AC-01、AC-02、AC-17）。
3. 確認後刷新教師頁。再將其中一格改成 `｛｛Q:3｝｝` 或使用未授權的試算表，重新預覽。確認錯誤指出格式或授權問題，且已確認的資料保留（AC-03）。
4. 用 `node --test 'tests/{unit,integration}/sheets-import/*.test.js'` 執行自動測試。依 [真實 Sheets 驗收紀錄](acceptance.md#真實線上試算表驗收)保存實際試算表連結及截圖。
