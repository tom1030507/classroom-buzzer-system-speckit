# SF-02 教師匯入 HTTP 契約

對應 FR-02、FR-08（匯入）及 AC-01～AC-03、AC-17。下列路徑共用 `/api/teacher/activities/:activityId/import` 前綴與有效教師 Cookie。所有 `POST` 需要同源 `Origin` 與 `X-CSRF-Token`，且活動須為 `PREPARING`。

- `GET` 回傳 `{ imported }`，首次確認前為 `null`。讀取既有資料可跨階段。
- `POST /sheets` 接受 `{ spreadsheet }`。值為雲端試算表 ID 或 Google Sheets URL，回應 `{ spreadsheetId, sheets: [{ id, title }] }`。
- `POST /preview` 接受 `{ spreadsheet, sheetIds }`，`sheetIds` 為教師指定順序且不重複的非空陣列。回應 `{ previewId, preview }`，不寫資料庫。
- `POST /confirm` 接受 `{ previewId }`，僅同一活動、原教師工作階段與有效期限內可用。回應 `{ imported }`。成功後該預覽無法重用。

`preview` 與 `imported` 包含 `spreadsheetId`、`questionCount`、`unitCount` 與有序 `units`。每單位含 `kind`、`groupCode`、`position`、`questions`。成員含題號 `key`、全域與單位內順序、工作表 ID 與名稱、零基底 `rowIndex`／`columnIndex`、`originalMarker` 及 A1 格位 `cell`。

錯誤為 `{ error: { code, message } }`。非法標記會回 `400 IMPORT_INVALID_MARKER` 並指出格位。活動階段錯誤回 `409 INVALID_PHASE`；預覽失效或工作階段不符回 `409 IMPORT_PREVIEW_INVALID`。無教師工作階段或驗證不符回 `401` 或 `403`。Google 權限、找不到來源、配額、網路及逾時各有清楚的錯誤代碼。
