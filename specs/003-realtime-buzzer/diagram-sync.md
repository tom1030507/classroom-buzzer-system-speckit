# SF-03 圖表同步紀錄

核對日期為 2026-11-19。對照 SF-03 PR 的實作及系統基準圖。

| 圖表 | 核對項目 | 程式位置 | 狀態 |
| --- | --- | --- | --- |
| Component | 分開的學生和教師投影、授權及伺服器串流 | `src/features/realtime-buzzer/router.js`、`snapshots.js`、`events.js` | match |
| Class | 受理序號、原文與不透明的個人受理識別 | 基礎 migration、`src/db/migrations/003-01-submission-receipts.sql` | match |
| Sequence submit | 驗證、去重、題組與序號在同一 SQLite 交易中處理 | `src/features/realtime-buzzer/submissions.js` | match |
| Sequence close | 結束與送出的序列，結束交易內的 SF-04 接點 | `src/features/realtime-buzzer/state.js`、`submissions.js` | match |

以 `npm run diagrams -- 'diagrams/003-*.puml'` 產生四張 PNG。結束後的最終結果運算由 #14 接上。
