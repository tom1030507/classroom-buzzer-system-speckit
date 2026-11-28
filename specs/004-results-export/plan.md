# Implementation Plan: SF-04 結果與匯出

**Branch**: `feat/004-results-export` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-results-export/spec.md`

## Summary

活動結束時，在 SF-03 的結束交易內以速度規則計算並保存每筆受理的最終順位（SF-05 之後加入公平規則）。
結束後老師與該活動的各組以獨立 API 取得同一份結果檢視；老師可下載符合 FR-09 的 CSV，並可預覽、確認後
把勝出答案以純文字寫回原雲端試算表的原答案格。寫回前後都重新讀取線上值：任一目標衝突就整批停止，
寫入後回讀核對，無法確定時記為「待核對」，並保存逐題寫回紀錄供查核與安全重試。設計決策見 [research.md](research.md)。

## Technical Context

**Language/Version**: Node.js 26 LTS（最低 24），ES modules；前端原生 JavaScript

**Primary Dependencies**: Express 5.3.0（既有），不新增套件；Google Sheets API v4 透過 SF-02 的 gateway（內建 `fetch` 與 `node:crypto`）

**Storage**: SQLite（內建 `node:sqlite`）；沿用 `results`，新增 `sheet_exports`、`sheet_export_items`

**Testing**: `node:test`；以 fixtures 建立資料，以假的 `fetch`／gateway 模擬 Google

**Target Platform**: 本機 Node.js 伺服器（只綁定 127.0.0.1）與桌面瀏覽器

**Project Type**: Web 應用（Express API＋SSE＋靜態前端），單一 repository

**Performance Goals**: 本機 1 位老師、10 組、20 題：結束後 2 秒內顯示結果；結束交易多出的計算為 O(受理數)

**Constraints**: 結束交易同步且不得 `await`；`await` Google 時不持有 SQLite 交易；Google 延遲不在承諾範圍，只顯示進度與錯誤

**Scale/Scope**: 每場活動最多約 10 組 × 20 題；CSV 與結果一次產生，不需要分頁或串流

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 檢查 | 結果 |
| --- | --- | --- |
| I. spec.md 為唯一基準 | 每條需求標註 FR／AC；不修改根目錄 `spec.md`；不實作歷史搜尋等 §10 排除項目 | 通過 |
| II. 後端權威與安全預設 | 教師端點經 `requireTeacher`，POST 另經 `requireMutation`（Origin＋CSRF）；學生只在 CLOSED 後讀自己活動的結果；答案以 `textContent` 呈現；錯誤訊息不含其他組資料或機密 | 通過 |
| III. 交易完整性與伺服器序列 | 結果在結束交易內同步保存；`results` 由基礎 trigger 保證不可修改；寫回紀錄以短交易寫入，不跨越 `await` | 通過 |
| IV. 直接線上串接 Google Sheets | 透過 API 寫回原格；`stringValue` 純文字（等同 RAW）；寫入前重新讀取核對，衝突即停止；保存逐題紀錄；測試替身只用於自動化測試 | 通過 |
| V. 測試先行與真實證據 | 每個 user story 先寫失敗的測試；AC 證據記錄於 `acceptance.md`，AC-12～AC-14、AC-20 附人工截圖 | 通過 |
| VI. 圖表驅動設計 | 以下列四張圖為藍圖；實作後執行 `/speckit-plantuml-sync` | 通過 |
| VII. 簡單且鎖定的技術棧 | 不新增套件；CSV 與 Google 呼叫都用既有工具 | 通過 |
| VIII. 無障礙與明確回饋 | 表格有標題與欄名、核取方塊有標籤、全部可用鍵盤操作；Google 操作顯示進行中；收到伺服器回覆前不顯示成功 | 通過 |

**Phase 1 設計後複查**：data-model 與 contracts 沒有引入新的違規；結果 API 只回傳結果所需欄位，不含組別 ID 與受理序號。通過。（2026-11-28 起 `acceptedOrder` 即受理序號，#32。）

## 設計藍圖（DC-03）

- [Component](../../diagrams/004-results-export-component.puml)：`src/features/results-export/` 的六個模組，
  以及使用的 SF-01 權限、SF-03 結束交易與 SF-02 gateway。
- [Class](../../diagrams/004-results-export-class.puml)：`results`、`sheet_exports`、`sheet_export_items`、
  寫回狀態與 `ResultView`。
- [Sequence：結束、結果與 CSV](../../diagrams/004-results-export-sequence.puml)：結束交易內的 `saveFinalResults`、
  兩種角色取得結果、CSV 下載。
- [Sequence：寫回](../../diagrams/004-results-export-sequence-writeback.puml)：預覽、互斥、寫入前核對、
  整批停止、寫入與回讀、待核對與重試。

### 後端模組（`src/features/results-export/`）

| 模組 | 職責 |
| --- | --- |
| `ranking.js` | `rankSpeed`、`RANKERS`（介面見 [contracts/ranking.md](contracts/ranking.md)） |
| `results.js` | `saveFinalResults`（結束交易內）、`readResults`（`ResultView`）、`listWinningAnswers`（寫回目標） |
| `csv.js` | `buildResultsCsv`：BOM、CRLF、轉義、公式防護 |
| `sheets-export.js` | `classifyTarget`（純函式）、`createSheetsExporter`：預覽、寫回、互斥 |
| `export-records.js` | `sheet_exports`／`sheet_export_items` 的讀寫與中斷復原 |
| `router.js` | `createResultsExportRouter`：六個端點（見 [contracts/http-api.md](contracts/http-api.md)） |

### 跨子功能修改（PR 中請負責人確認）

| 檔案 | 擁有者 | 修改 |
| --- | --- | --- |
| `src/features/realtime-buzzer/state.js` | SF-03 | 結束分支呼叫 `saveFinalResults`（SF-03 預留的接點） |
| `src/features/sheets-import/gateway.js` | SF-02 | 新增 `readTargets`、`writeCells`（沿用既有的授權與錯誤對應；檔案註解已預留給 SF-04） |
| `src/app.js` | 共用 | 建立共用的 gateway 實例；掛載 `createResultsExportRouter` |
| `public/teacher/realtime-buzzer.js` | SF-03 | 活動結束後隱藏監看表，由結果表取代 |
| `public/teacher/index.html`、`public/student/index.html` | 共用 | 新增結果區塊與模組 |

## Project Structure

### Documentation (this feature)

```text
specs/004-results-export/
├── spec.md              # 功能規格（含 Clarifications）
├── plan.md              # 本檔
├── research.md          # Phase 0：設計決策
├── data-model.md        # Phase 1：資料表、狀態與 API 資料形狀
├── quickstart.md        # Phase 1：驗證指南
├── contracts/
│   ├── http-api.md      # HTTP 端點
│   └── ranking.md       # 給 SF-05 的順位計算介面
├── checklists/
│   └── requirements.md  # 規格品質檢查
├── tasks.md             # Phase 2（/speckit-tasks）
├── diagram-sync.md      # 實作後（/speckit-plantuml-sync）
└── acceptance.md        # 驗收紀錄
```

### Source Code (repository root)

```text
src/
├── app.js                                   # 共用 gateway、掛載 SF-04 router
├── db/migrations/
│   ├── 004-01-backfill-speed-results.sql    # 補齊上線前已結束活動的速度結果
│   └── 004-02-sheet-exports.sql             # 寫回紀錄
└── features/
    ├── results-export/
    │   ├── ranking.js
    │   ├── results.js
    │   ├── csv.js
    │   ├── sheets-export.js
    │   ├── export-records.js
    │   └── router.js
    ├── realtime-buzzer/state.js             # 結束分支接上 saveFinalResults
    └── sheets-import/gateway.js             # 新增 readTargets、writeCells

public/
├── js/results-view.js                       # 老師與學生共用的結果表
├── teacher/
│   ├── index.html                           # #results-export 區塊
│   ├── results-export.js                    # 結果表、寫回、CSV
│   └── realtime-buzzer.js                   # 結束後隱藏監看表
└── student/
    ├── index.html                           # #student-results 區塊
    └── results-export.js                    # 學生結果

tests/
├── unit/
│   ├── results-export/
│   │   ├── ranking.test.js
│   │   ├── results.test.js
│   │   ├── backfill.test.js
│   │   ├── csv.test.js
│   │   └── sheets-export.test.js
│   └── sheets-import/gateway.test.js        # 新增 readTargets、writeCells 的請求格式測試
└── integration/results-export/results-export.test.js
```

**Structure Decision**: 沿用既有的單一專案結構，SF-04 的後端集中在 `src/features/results-export/`，
前端模組依角色放在 `public/teacher/`、`public/student/`，測試依 unit／integration 分開。

## Complexity Tracking

沒有違反 constitution 的設計，不需要說明。
