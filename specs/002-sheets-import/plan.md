# SF-02 實作計畫

規格見 [SF-02](spec.md)。實作沿用 Express、Node、SQLite 與原生 JavaScript。

- [元件圖](../../diagrams/002-sheets-import-component.puml) 定義教師頁、授權、匯入 router、解析器、資料存取與 Google Gateway 的責任。
- [類別圖](../../diagrams/002-sheets-import-class.puml) 定義單位、題目、格位與暫存預覽的資料。
- [循序圖](../../diagrams/002-sheets-import-sequence.puml) 定義工作表選擇、取得預覽與單一交易確認的流程。

## 契約

`/api/teacher/activities/:activityId/import` 下提供：

- `POST /sheets` 接受 `{spreadsheet}`（雲端網址或 ID），回傳 `{spreadsheetId,sheets}`。每張工作表回傳數字 ID 與名稱。
- `POST /preview` 接受 `{spreadsheet,sheetIds}`，順序依陣列，回傳 `{previewId,preview}`。預覽含來源 ID、單位和題目數，列出原標記、工作表與格位。
- `POST /confirm` 接受 `{previewId}`，回傳 `{imported}`，內含已保存的預覽明細。預覽只可確認一次。解析及雲端失敗發生於資料庫交易之前，交易中的寫入失敗會復原。
- `GET /` 回傳 `{imported}` 供教師頁重載上次已確認的匯入。沒有已確認資料時為 null。

Gateway 以服務帳戶憑證簽署 OAuth assertion，僅取得 Sheets 讀寫 scope。使用 Node 內建的 fetch 與 `crypto.sign`，限定 Google 的 token 與 API 網域。單一 JWT 交換流程不增加套件，測試會驗證簽章與 scope。GET 讀取工作表清單，`getByDataFilter` 以 sheetId 讀取原始格值、合併範圍及格線結構，保留供 SF-04 重新讀取與核對所需的資訊。

## Constitution Check

根規格及基礎 migration 不變。後端套用 SF-01 的教師權限、Origin 與 CSRF。匯入確認採 `withTransaction`；權限、解析及替換失敗由自動測試覆蓋。有效的真實試算表及服務帳戶權限需依驗收紀錄另行查驗。
