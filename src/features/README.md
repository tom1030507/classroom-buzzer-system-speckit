# Feature modules

每個子功能一個資料夾，資料夾名稱沿用 `specs/NNN-<slug>/` 的 slug：

| 子功能 | 資料夾 | 主要職責 |
| --- | --- | --- |
| SF-01 活動與組別 | `activity-groups/` | 教師密碼驗證、工作階段 Cookie、CSRF／Origin、建立活動、加入碼、組別加入與重連 |
| SF-02 線上題目匯入 | `sheets-import/` | Google Sheets 讀取、標記解析、單題／題組單位建立、預覽與確認匯入 |
| SF-03 即時搶答 | `realtime-buzzer/` | 狀態轉移（開啟／結束）、SSE 同步與事件過濾、原子受理、教師監看 |
| SF-04 結果與匯出 | `results-export/` | 結束時結果保存（速度模式）、結果檢視、線上寫回 Sheets、CSV |
| SF-05 公平排序 | `fair-ranking/` | 模式選擇與鎖定、公平順位計算、與結果／Sheets／CSV 整合 |

## 模組約定

- 對外匯出 `create<Name>Router(deps)`，回傳 Express `Router`，並在 `src/app.js` 以一行
  `api.use(...)` 掛載到 `/api`。`deps` 為 `{ db, config, logger, clock }`。
- 其他子功能需要的能力，以具名匯出的 service 函式提供（例如 SF-03 呼叫 SF-01 的
  `requireGroupSession`）；不直接 import 其他子功能的 repository 或修改其資料表。
- 需要交易的操作一律透過 `src/db/transaction.js` 的 `withTransaction`，callback 必須是同步函式。
- 錯誤以 `src/lib/errors.js` 的 `AppError` 拋出，由全域錯誤處理轉成 `{ error: { code, message } }`。
- 學生可見的回應與事件都要在後端過濾（constitution 原則 II）。
- 測試放在 `tests/unit/<slug>/`、`tests/integration/<slug>/`。
