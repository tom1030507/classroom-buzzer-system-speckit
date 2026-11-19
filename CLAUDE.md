# CLAUDE.md

本專案以 GitHub Spec Kit 做規格驅動開發。開始任何工作前：

1. 讀 `.specify/memory/constitution.md`（工程原則，必須遵守）與 `spec.md`（產品規格）。
   **不得修改 `spec.md`**；需要變更時停下來告知使用者，依 spec.md §10 另開 PR。
2. 確認目前處理的子功能。Spec Kit 指令以 `.specify/feature.json` 或 `SPECIFY_FEATURE_DIRECTORY`
   找功能目錄；編號固定如下，不可自行產生新編號：

| 子功能 | 功能目錄 | 分支 |
| --- | --- | --- |
| SF-01 活動與組別 | `specs/001-activity-groups` | `feat/001-activity-groups` |
| SF-02 線上題目匯入 | `specs/002-sheets-import` | `feat/002-sheets-import` |
| SF-03 即時搶答 | `specs/003-realtime-buzzer` | `feat/003-realtime-buzzer` |
| SF-04 結果與匯出 | `specs/004-results-export` | `feat/004-results-export` |
| SF-05 公平排序 | `specs/005-fair-ranking` | `feat/005-fair-ranking` |

## 指令

- `npm test`：所有自動化測試（`node:test`），合併前必須通過
- `npm start`：啟動伺服器（http://127.0.0.1:3000）
- `npm run diagrams [-- <files>]`：PlantUML → PNG

## 程式慣例

- ES modules。前端只用 HTML／CSS／原生 JS，無框架、無建置步驟；後端 Express 5；
  SQLite 使用內建 `node:sqlite`。新增套件前先在 plan.md 說明理由，版本鎖定精確值。
- 交易一律使用 `src/db/transaction.js` 的 `withTransaction(db, fn)`；`fn` 必須是同步函式，
  交易內不得 `await`（送出與結束靠它序列化）。
- 錯誤丟 `src/lib/errors.js` 的 `AppError`；API 錯誤格式為 `{ error: { code, message } }`。
- 學生可見的資料一律在後端過濾；使用者輸入只以 `textContent`（`public/js/dom.js`）呈現。
- 子功能程式放 `src/features/<slug>/`，router 在 `src/app.js` 掛載（見 `src/features/README.md`）。
- Schema 變更新增 migration，不改已合併的檔案（見 `src/db/migrations/README.md`）。
- 測試放 `tests/unit/`、`tests/integration/`，檔名 `*.test.js`；可用 `tests/helpers/` 的
  `startTestApp`、`createTestDatabase` 與 fixtures。
- 時間存 UTC ISO 8601；需要時間的邏輯注入 `clock`，不要直接 mock `Date`。

## 圖表（DC-03）

`/speckit-specify` 完成後會自動執行 `/speckit-plantuml-diagrams`；實作完成後會執行
`/speckit-plantuml-sync`。圖表命名 `diagrams/<功能目錄名>-{component,class,sequence}.puml`，
必須與 `diagrams/system-*.puml` 一致，PNG 只能由 `npm run diagrams` 產生。

## 機密

服務帳戶金鑰放在 repository 之外，以 `GOOGLE_APPLICATION_CREDENTIALS` 指定路徑；
`.env`、`data/`、`*.sqlite`、教師設定與工作階段都不得提交，也不得出現在 log 或回應中。
