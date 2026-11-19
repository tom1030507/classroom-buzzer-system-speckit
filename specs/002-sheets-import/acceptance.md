# SF-02 驗收紀錄

負責人為 tom1030507。驗收範圍見 [SF-02 規格](spec.md)。

## 自動化

Node.js 24.17.0 上，25 項 SF-02 測試通過。執行方式為 `node --test --test-reporter=spec 'tests/{unit,integration}/sheets-import/*.test.js'`。

- **AC-02（匯入）、AC-17（匯入）**。解析器測試包含兩張不同格線版面的工作表、五道非連續題號、三個作答單位、跨工作表的三成員題組與 AA 欄之後的格位。HTTP 測試確認教師預覽與保存的題號、格位、原標記一致。[解析器測試](../../tests/unit/sheets-import/parser.test.js) · [匯入 API 測試](../../tests/integration/sheets-import/import.test.js)
- **AC-03**。測試零題、重複和非法標記、合併儲存格、單成員題組、無權限、試算表不存在、配額、斷網和逾時。HTTP 測試驗證預覽、讀取、寫入失敗時舊匯入仍可查詢，並以 SQLite trigger 確認部分寫入失敗會復原。測試也涵蓋 Google 讀取尚未完成時活動已開啟的競態。[Gateway 測試](../../tests/unit/sheets-import/gateway.test.js) · [匯入 API 測試](../../tests/integration/sheets-import/import.test.js)
- **教師權限與階段**。HTTP 測試驗證教師登入、Origin／CSRF、階段鎖定及預覽僅限原活動和原工作階段。[匯入 API 測試](../../tests/integration/sheets-import/import.test.js)

## 真實線上試算表驗收

**狀態為待驗證。** 本次執行環境沒有可用的服務帳戶憑證或已授權的課程試算表。自動測試以測試替身檢驗對 Google 的請求和錯誤處理。

1. 在 Google Cloud 啟用 Sheets API，配置服務帳戶。將憑證 JSON 放在 repository 之外，由 `GOOGLE_APPLICATION_CREDENTIALS` 指向該檔。使用服務帳戶 email 以編輯者權限共用課程範本副本。
2. 在兩張工作表的獨立答案格填入兩個單題與三個同代號的題組標記，例如 `{{Q:3}}`、`{{Q:81}}`、`{{Q:6|G:A}}`、`{{Q:9|G:A}}`、`{{Q:14|G:A}}`。讓題組分散於兩張工作表，並使用不同列欄。
3. 開啟教師頁、建立活動、輸入副本網址、載入與調整工作表順序，產生預覽。核對五題、三個作答單位、題組成員與每題原格位，再按確認。重新整理頁面，核對已確認匯入顯示相同結果。記錄試算表連結、工作表順序及預覽與確認截圖（AC-01、AC-17）。
4. 使用一份未共用的試算表或錯誤 ID 嘗試匯入，確認畫面有錯誤且保留原匯入。切斷外部網路並保留本機連線，再呼叫 Sheets 匯入，確認錯誤與原資料。另於範本副本逐一製造空白、重複、非法標記、合併格及單成員題組，確認每次都保留上次確認的匯入。保留畫面截圖及測試情境（AC-03）。
5. 更換不同版面的試算表副本，以非連續題號移動格位後匯入。記錄新表連結與預覽，核對位置與新表一致（AC-02 的匯入部分）。
