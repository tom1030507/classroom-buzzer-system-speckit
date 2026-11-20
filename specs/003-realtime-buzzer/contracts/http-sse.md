# SF-03 HTTP 與 SSE 契約

對應 FR-03～FR-05、FR-08 的送出部分。所有路徑均使用 `/api` 前綴。伺服器以 SF-01 的教師或組別 Cookie 授權，POST 需要正確的 `Origin` 與 `X-CSRF-Token`。JSON 錯誤格式為 `{ error: { code, message } }`。

## 教師控制與監看

- `GET /api/teacher/activities/:activityId/live` 取得教師快照，含 `activity: { id, status, mode }`、`groups`、`units`、`imported` 和 `importRevision`。`units` 含 `id`、`kind`、題號 `questions: [{ key }]`、已依 `acceptSeq` 排序的 `submissions` 及 `winnerGroupId`。作答項目含 `unitId`、`groupId`、`acceptedAt`、`acceptSeq` 與 `answers: [{ questionKey, text }]`。只有 `SPEED` 且 `OPEN` 才回傳暫定勝出組的 ID，無受理時為 `null`。`imported` 和 `importRevision` 在離開 `PREPARING` 後為 `null`。
- `GET /api/teacher/activities/:activityId/events` 以 SSE 傳送同一教師快照。學生工作階段無法使用教師路由。
- `POST /api/teacher/activities/:activityId/open` 從 `PREPARING` 開啟已有題目的活動，回 `{ activity }`。教師介面提供 `{ importRevision }`，當提供的版本與目前已確認匯入不符時回 `409 IMPORT_CHANGED`。沒有已確認題目時回 `409 NO_QUESTIONS`，階段不符時回 `409 INVALID_PHASE`。
- `POST /api/teacher/activities/:activityId/close` 接受 `{ confirm: true }`，從 `OPEN` 結束，回 `{ activity }`。缺少明確確認回 `400 CLOSE_CONFIRMATION_REQUIRED`，階段不符回 `409 INVALID_PHASE`。

## 學生快照與送出

- `GET /api/student/activity` 的活動取自組別 Cookie，回 `{ activity: { id, mode, status }, units }`。單位含 `id`、`kind`、題號 `questions: [{ key }]` 與本組 `receipt` 或 `null`。
- `GET /api/student/events` 以 SSE 送出同一學生快照。別組送出不改變此投影。學生快照不含教師的組別名單、他組答案、受理序號或暫定勝出者。
- `POST /api/student/units/:unitId/submissions` 接受 `{ answers: [{ questionKey, text }] }`。送出內容恰好包括該單位的全部成員，每個題號出現一次。`201` 代表首次受理，`200` 代表 `OPEN` 期間有效重送；兩者回 `{ receipt }`。
- `receipt` 含不透明的 `id`、`unitId`、伺服器的 `acceptedAt` 和依單位順序排列的原文 `answers`。`PREPARING` 和 `CLOSED` 的作答 POST 均回 `409 INVALID_PHASE`，已受理單位的重送也依同一階段規則處理。`CLOSED` 仍可從 GET 或 SSE 取回本人已受理的資料。

缺少工作階段回 `401`，Origin、CSRF 或聲稱別組身分回 `403`。錯誤單位回 `404 INVALID_UNIT`，錯誤題號回 `400 INVALID_QUESTION`，內容、數量或重複題號錯誤回 `400 INVALID_ANSWERS`。開啟階段先按單位成員及 JSON 編碼的上限讀取請求，超出大小時回 `413 PAYLOAD_TOO_LARGE`。交易內仍會重新驗證組別、階段、單位、題號及作答內容。

## 串流格式

使用 `text/event-stream; charset=utf-8`，每個 `snapshot` 事件的 `data` 為完整授權快照 JSON。初連與重連各收到一筆目前的快照。之後每 250 毫秒比對該工作階段的投影，只有內容變更才送出新快照。無變更時以 `: keep-alive` 註解維持連線，至少間隔 15 秒。工作階段失效時結束串流，重連需重新通過授權。
