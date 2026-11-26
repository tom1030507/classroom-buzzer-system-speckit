# SF-01 HTTP 契約

對應 FR-01 與 AC-04、AC-08、AC-15、AC-16、AC-24。所有 `POST` 需要同源 `Origin` 與 `X-CSRF-Token`。

## 教師

- `GET /api/teacher/session` 取得 `{ authenticated, setupRequired, csrfToken }`。
- `POST /api/teacher/login` 接受 `{ password }`，成功核發教師 Cookie 並回傳 `{ authenticated: true, csrfToken }`。`POST /api/teacher/logout` 撤銷目前教師 Cookie，回傳預備工作階段的 CSRF token。
- `POST /api/teacher/activities` 需要教師 Cookie，建立活動並回傳 `201`、活動、組別名單及可選活動；活動的 `joinCode` 為六碼，字元集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`。已有未結束活動時回 `409 ACTIVITY_UNFINISHED`（AC-24）。`GET /api/teacher/activities/current` 或 `GET /api/teacher/activities/:activityId` 以教師 Cookie 讀取活動及名單。

## 學生

- `GET /api/student/session` 回傳 `{ group, activity, csrfToken }`。未加入時 `group` 與 `activity` 是 `null`；已加入的回覆含本人組名及活動 ID、模式與階段。
- `POST /api/student/join` 接受 `{ joinCode, name }`；`joinCode` 不分大小寫，`name` 去除前後空白後須為 1～30 個 Unicode 字元，否則回 `400 INVALID_JOIN`（AC-24）。活動準備中時回 `201`，核發組別 Cookie 及新的 CSRF token。重試同一請求時可取回原工作階段。
- `POST /api/student/leave` 不需請求主體。後端以有效學生 Cookie 驗證本人，僅活動在 `PREPARING` 時撤銷組別及工作階段。成功回 `200`、`{ group: null, activity: null, csrfToken }` 及新的預備 Cookie。

錯誤使用 `{ error: { code, message } }`。退出時缺組別工作階段回 `401 GROUP_REQUIRED`；Origin 或 CSRF 不合回 `403`；活動已開啟或結束回 `409 INVALID_PHASE`。
