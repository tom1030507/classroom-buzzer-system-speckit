# SF-01 驗收紀錄

執行 `npm test`。下列案例位於 `tests/integration/activity-groups/activity-groups.test.js`。

- AC-04：準備中可加入，活動開啟後拒絕新組別。
- AC-08：同名及偽造組別 ID 不能取得他組工作階段；學生取得的工作階段只有自己的組名。
- AC-15（身分）：以檔案型 SQLite 停止並重啟伺服器，原教師 Cookie 和學生 Cookie 仍能還原。
- AC-16（身分）：無有效教師 Cookie、帶學生 Cookie、外站或缺少 Origin、不正確 CSRF 及登出後重放均拒絕；驗證 Cookie 旗標。

另外以暫存 SQLite 執行教師設定 CLI 兩次，第一回設定成功，第二回保留既有設定。
