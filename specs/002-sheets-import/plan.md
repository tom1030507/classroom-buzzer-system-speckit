# SF-02 實作計畫

規格見 [SF-02](spec.md)。實作沿用 Express、Node、SQLite 與原生 JavaScript。

- [元件圖](../../diagrams/002-sheets-import-component.puml) 定義教師頁、授權、匯入 router、解析器、資料存取與 Google Gateway 的責任。
- [類別圖](../../diagrams/002-sheets-import-class.puml) 定義單位、題目、格位與暫存預覽的資料。
- [循序圖](../../diagrams/002-sheets-import-sequence.puml) 定義工作表選擇、取得預覽與單一交易確認的流程。

## 技術背景

- Node.js 24 以上、Express 5、原生 JavaScript，測試使用 `node:test`。CI 使用 `.nvmrc` 指定的 Node.js 26。
- Google 呼叫經 Gateway 完成，SQLite 持久化 `units`、`questions`，伺服器記憶體暫存教師預覽。執行環境為 localhost；只有後端讀取 repository 外的服務帳戶憑證。
- 預覽若遇到非法格式、中途開啟、授權或網路失敗，教師看到具體錯誤；先前確認的資料保留。真實 Google 呼叫的等待時間由介面呈現，不納入搶答的兩秒同步標準。

## 實作與驗證入口

- `src/features/sheets-import/parser.js` 解析與排序；`gateway.js` 讀取 Google；`router.js` 和 `units.js` 實作預覽與確認；`public/teacher/sheets-import.js` 提供教師介面。
- [設計決策](research.md)、[資料模型](data-model.md)、[匯入 API 契約](contracts/import.md)、[驗證方式](quickstart.md)、[任務追溯](tasks.md)對照上述圖表與實作路徑。

## Constitution Check

根規格及基礎 migration 不變。後端套用 SF-01 的教師權限、Origin 與 CSRF。匯入確認採 `withTransaction`；權限、解析及替換失敗由自動測試覆蓋。有效的真實試算表及服務帳戶權限需依驗收紀錄另行查驗。
