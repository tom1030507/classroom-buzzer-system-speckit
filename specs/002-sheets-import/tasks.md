# SF-02 任務

## 解析與讀取

- [x] T001（#6，US1，FR-02、FR-08，AC-02、AC-03、AC-17）實作 `src/features/sheets-import/parser.js`，由 `tests/unit/sheets-import/parser.test.js` 驗證解析、排序、題組、格位及全形標記拒絕。
- [x] T002（#7，US2，FR-02，AC-01、AC-03）實作 `src/features/sheets-import/gateway.js`；`tests/unit/sheets-import/gateway.test.js` 驗證憑證、簽章、Sheets scope、讀取與錯誤映射。

## 教師匯入與驗證

- [x] T003（#8，US3，FR-02、FR-08，AC-02、AC-03、AC-17）接上 `router.js`、`units.js` 及 `public/teacher/sheets-import.js`，由 `tests/integration/sheets-import/import.test.js` 驗證教師授權、階段、預覽、確認及失敗保留舊匯入。
- [x] T004（#5，DC-02、DC-03）核對圖表、契約、測試與 [驗收紀錄](acceptance.md)。
- [x] T005（#5、#7、#8，US2、US3，FR-02，AC-01、AC-03）依驗收紀錄使用真實雲端試算表，保存試算表連結與結果截圖。
