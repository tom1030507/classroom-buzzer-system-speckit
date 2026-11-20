# SF-04 HTTP API

所有路徑都在 `/api` 底下；錯誤格式為 `{ "error": { "code", "message" } }`。教師端點需要教師工作階段
（否則 401 `TEACHER_REQUIRED`），學生端點需要組別工作階段（否則 401 `GROUP_REQUIRED`）。
POST 端點另需同源 `Origin` 與 `X-CSRF-Token`（否則 403 `INVALID_ORIGIN`／`INVALID_CSRF`）。
活動不存在時回應 404 `ACTIVITY_NOT_FOUND`。

## 結果

### `GET /api/teacher/activities/:activityId/results`

- 200：[`ResultView`](../data-model.md#結果檢視-resultviewapi-回應結果頁與-csv-共用)
- 409 `INVALID_PHASE`：活動尚未結束

### `GET /api/student/results`

- 200：目前工作階段所屬活動的 `ResultView`
- 409 `INVALID_PHASE`：活動尚未結束（訊息不含任何其他組的資訊）

### `GET /api/teacher/activities/:activityId/results.csv`

- 200：`Content-Type: text/csv; charset=utf-8`、`Content-Disposition: attachment; filename="results-<activityId>.csv"`
- 內容：UTF-8 BOM＋CRLF，欄位 `activity_id,mode,unit_id,question_id,group_name,answer,accepted_at,accepted_order,rank,is_winner`
- 409 `INVALID_PHASE`：活動尚未結束
- 學生工作階段呼叫時為 401 `TEACHER_REQUIRED`

## 寫回原 Google Sheets

### `POST /api/teacher/activities/:activityId/sheets-export/preview`

- Body：`{}`
- 200：

  ```json
  { "spreadsheetId": "…", "items": [ /* 逐題項目，見 data-model.md */ ],
    "counts": { "READY": 3, "ALREADY_PRESENT": 0, "CONFLICT": 0, "NO_ANSWER": 2 } }
  ```

- 409 `INVALID_PHASE`
- Google 錯誤沿用 SF-02 gateway 的代碼與狀態：`SHEETS_CREDENTIALS`（503）、`SHEETS_AUTH`（502）、
  `SHEETS_PERMISSION`（403）、`SHEETS_NOT_FOUND`（404）、`SHEETS_QUOTA`（429）、`SHEETS_TIMEOUT`（504）、
  `SHEETS_NETWORK`、`SHEETS_API`、`SHEETS_BAD_RESPONSE`（502）

### `POST /api/teacher/activities/:activityId/sheets-export`

- Body：`{ "editsPaused": true }`
- 200：本次寫回的紀錄（不論成功與否，只要已開始寫回就有紀錄）

  ```json
  { "export": { "id": 7, "outcome": "SUCCEEDED", "startedAt": "…", "finishedAt": "…",
                "error": null, "items": [ /* 逐題項目 */ ],
                "counts": { "WRITTEN": 3, "ALREADY_PRESENT": 0 } } }
  ```

  `outcome` 不是 `SUCCEEDED` 時，前端必須顯示為未完成；`error` 為整批錯誤 `{ code, message }` 或 `null`。
- 400 `EDITS_PAUSE_REQUIRED`：未確認已暫停其他人編輯
- 409 `INVALID_PHASE`、409 `EXPORT_IN_PROGRESS`（同一活動已在寫回）、409 `NOTHING_TO_EXPORT`（沒有勝出答案）

### `GET /api/teacher/activities/:activityId/sheets-export`

- 200：`{ "export": <最近一次寫回的紀錄> | null }`。遺留的 `RUNNING` 會先改為 `UNKNOWN`（`INTERRUPTED`）。

## SF-03 結束端點的變更

`POST /api/teacher/activities/:activityId/close` 的行為不變，另在同一交易保存結果。新增錯誤：

- 409 `RANKING_UNAVAILABLE`：活動模式沒有登錄的順位計算；活動維持搶答中。SF-05 加入公平模式的順位計算後，
  兩種模式都有，這個錯誤只是防止日後新增模式卻忘了登錄。
