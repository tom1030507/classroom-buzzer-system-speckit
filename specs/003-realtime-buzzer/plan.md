# SF-03 實作計畫

規格見 [SF-03](spec.md)。Express、SQLite 與原生 EventSource 延用共同基礎。

- [元件](../../diagrams/003-realtime-buzzer-component.puml) 以 SF-01 提供身分、SF-02 提供匯入單位；教師和學生使用各自的快照投影。
- [資料模型](../../diagrams/003-realtime-buzzer-class.puml) 用受理序號排序，以不透明識別顯示學生本人紀錄。
- [送出循序](../../diagrams/003-realtime-buzzer-sequence-submit.puml) 在同一交易驗證、去重與儲存單位的所有答案。
- [結束競態](../../diagrams/003-realtime-buzzer-sequence-close.puml) 定義兩條路徑共用 `withTransaction` 與 SF-04 的結束交易擴充點。

教師使用 `/api/teacher/activities/:activityId/live`、`/events` 監看，`POST /open`、`POST /close` 控制活動。學生使用 `/api/student/activity`、`/events` 及 `POST /api/student/units/:unitId/submissions`。教師的準備中快照包含已確認的匯入與版本值，開啟請求帶上該版本；若格位或題目已被另一分頁取代，伺服器在狀態交易內拒絕。SSE 每 250 毫秒讀取各工作階段的快照，初次連線與重連送完整快照，後續僅在該工作階段的可見資料改變時送出 `snapshot` 事件。與其他組的作答同步無關的連線以固定週期送心跳。

## Constitution Check

兩種快照各自從允許的資料建立，學生投影沒有名單、順位、其他組的作答或內部受理序號。送出與結束都在 `withTransaction` 中完成，任何失敗整筆復原。前端依伺服器回覆顯示受理，使用 `textContent` 和具標籤的表單。作答端點依目前單位成員數限制請求大小，容納每題 1,000 個字元的合法答案與 JSON 跳脫。
