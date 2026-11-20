# SF-05 HTTP API

所有路徑都在 `/api` 底下；錯誤格式為 `{ "error": { "code", "message" } }`。教師端點需要教師工作階段
（否則 401 `TEACHER_REQUIRED`），POST 另需同源 `Origin` 與 `X-CSRF-Token`（否則 403 `INVALID_ORIGIN`／`INVALID_CSRF`）。
SF-05 只新增一個端點；學生沒有新端點，學生取得模式的方式沿用 SF-01 的組別工作階段與 SF-03 的快照。

## 新增：選擇活動模式

### `POST /api/teacher/activities/:activityId/mode`

- Body：`{ "mode": "SPEED" }` 或 `{ "mode": "FAIR" }`；body 上限 8 kB，不接受其他欄位。
- 200：更新後的活動

  ```json
  { "activity": { "id": "…", "joinCode": "…", "status": "PREPARING", "mode": "FAIR", "createdAt": "…" } }
  ```

  準備中選回目前的模式也回 200，模式沒有變化。
- 400 `INVALID_MODE`：模式缺漏、不是 `SPEED` 或 `FAIR`，或 body 有多餘欄位。模式不變。
- 404 `ACTIVITY_NOT_FOUND`
- 409 `INVALID_PHASE`：活動已開啟或已結束（含選回相同模式）。訊息說明活動開啟後模式已鎖定。模式不變。
- 學生工作階段或未登入者呼叫：401 `TEACHER_REQUIRED`，不會改變模式。
- 檢查順序：教師工作階段 → Origin＋CSRF → body 驗證（400）→ 交易內的存在性（404）與階段（409）。
- 與 `POST …/open`、`POST …/close` 在同一序列處理：並行時依伺服器交易先後只會有一種結果。

## 行為改變的既有端點（輸入輸出格式不變）

| 端點 | SF-04 時 | SF-05 起 |
| --- | --- | --- |
| `POST /api/teacher/activities/:activityId/close` | 公平模式活動回 409 `RANKING_UNAVAILABLE`，活動維持 `OPEN` | 公平模式活動可結束，結果以公平規則與結束狀態同交易保存；保存失敗時整個回滾，活動維持 `OPEN` |
| `GET /api/teacher/activities/:activityId/results`、`GET /api/student/results` | 回傳速度模式的 `ResultView` | 公平模式回傳同格式的 `ResultView`：`activity.mode` 為 `FAIR`，各單位 `entries` 依 `rank` 排序，`acceptedOrder` 與 `rank` 可不同 |
| `POST …/sheets-export/preview`、`POST …/sheets-export` | 以速度規則的勝出者為準 | 以 `results.is_winner = 1` 為準，公平模式下即公平規則的勝出者 |
| `GET …/results.csv` | `mode` 欄為 `SPEED` | 公平模式的 `mode` 欄為 `FAIR`，`rank` 與 `accepted_order` 分開，`is_winner` 取自 `results` |
| `GET /api/teacher/activities/:id/live`、`…/events`、`GET /api/student/activity`、`…/events` | `activity.mode` 固定為建立時的 `SPEED` | `activity.mode` 反映準備中的選擇；模式改變時 SSE 推送新快照（不新增事件） |

## 隱私

- 模式端點回應只含活動欄位，不含任何組別資訊。
- 學生快照與 API 不新增任何欄位；公平模式活動結束前，學生取得的資料與速度模式相同：只有自己組別的資料與受理紀錄。
- 規則說明是前端固定文字，不經任何 API。
