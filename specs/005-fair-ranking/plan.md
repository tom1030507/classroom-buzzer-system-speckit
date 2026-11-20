# Implementation Plan: SF-05 公平排序

**Branch**: `feat/005-fair-ranking` | **Date**: 2026-11-20 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-fair-ranking/spec.md`

## Summary

公平模式活動結束時，在 SF-03 的結束交易內，以本功能提供的同步純函式 `rankFair` 依單位順序逐一計算每筆受理的
最終順位：此前勝出次數少者優先，相同則受理序號小者優先，第 1 名勝出並使該組勝出次數加一。結果經 SF-04 的
`RANKERS.FAIR` 寫入 `results`，結果頁、寫回與 CSV 本來就只讀這份資料與活動模式，不需修改輸出邏輯。
老師在準備中以新端點 `POST /api/teacher/activities/:activityId/mode` 選擇或改選模式，活動開啟後在後端與資料庫兩層鎖定。
模式變更靠 SF-03 既有的 SSE 快照（已含 `activity.mode`）即時同步給老師與已加入的學生；規則說明是前端固定文字，
老師、學生與結果頁都會顯示，公平模式附一個簡短範例。不新增資料表、migration 或套件。設計決策見 [research.md](research.md)。

## Technical Context

**Language/Version**: Node.js 26 LTS（最低 24），ES modules；前端原生 JavaScript

**Primary Dependencies**: Express 5.3.0（既有），不新增套件

**Storage**: SQLite（內建 `node:sqlite`）；沿用 `activities.mode`、`units.position`、`submissions`、`results`，不新增資料表或 migration

**Testing**: `node:test`；以 fixtures 建立資料，以 `startTestApp` 啟動真實 Express app 做 HTTP 測試

**Target Platform**: 本機 Node.js 伺服器（只綁定 127.0.0.1）與桌面瀏覽器

**Project Type**: Web 應用（Express API＋SSE＋靜態前端），單一 repository

**Performance Goals**: 本機 1 位老師、10 組、20 題：結束後 2 秒內顯示結果；改選模式後 2 秒內各畫面更新。公平順位計算為 O(單位數 × 受理數 log 受理數)，遠小於 1 毫秒量級

**Constraints**: `rankFair` 是同步純函式，在結束交易內執行，不得讀寫資料庫或 `await`；模式更新與開啟、結束都走 `withTransaction`，由同一序列處理

**Scale/Scope**: 每場活動最多約 10 組 × 20 題；勝出次數只存在於計算過程，不保存

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 檢查 | 結果 |
| --- | --- | --- |
| I. spec.md 為唯一基準 | 每條需求標註 FR／AC；不修改根目錄 `spec.md`；不採跨活動歷史，不實作 §10 排除項目 | 通過 |
| II. 後端權威與安全預設 | 模式端點經 `requireTeacher`，POST 另經 `requireMutation`（Origin＋CSRF）；階段檢查與模式值驗證在後端；學生快照與 API 不新增任何欄位，規則說明是不含活動資料的固定文字；一律以 `textContent` 呈現 | 通過 |
| III. 交易完整性與伺服器序列 | 公平順位在結束交易內同步計算並與結束狀態一起保存；改選模式與開啟、結束經同一個 `withTransaction`（`BEGIN IMMEDIATE`）序列化；`results` 由基礎 trigger 保證不可修改 | 通過 |
| IV. 直接線上串接 Google Sheets | 不新增 Google 呼叫；寫回沿用 SF-04，勝出答案取自 `results` 的 `is_winner` | 通過 |
| V. 測試先行與真實證據 | `rankFair` 先以 AC-21、AC-22 向量與不變式寫失敗測試；AC-21～AC-23 各有自動化測試，畫面操作以瀏覽器證據記錄於 `acceptance.md` | 通過 |
| VI. 圖表驅動設計 | 以下列四張圖為藍圖；實作後執行 `/speckit-plantuml-sync` | 通過 |
| VII. 簡單且鎖定的技術棧 | 不新增套件、資料表或設定；規則說明不經 API，直接放在前端模組 | 通過 |
| VIII. 無障礙與明確回饋 | 模式選項為有 `legend` 的單選群組、有標籤、可用鍵盤操作；鎖定與錯誤以文字表達；送出中顯示處理中，收到伺服器回覆前不顯示已更新 | 通過 |

**Phase 1 設計後複查**：data-model 與 contracts 沒有引入新的違規；模式端點回應只含活動欄位（不含組別資訊），
學生端沒有新端點。通過。

## 設計藍圖（DC-03）

- [Component](../../diagrams/005-fair-ranking-component.puml)：`src/features/fair-ranking/` 的三個模組、前端三個模組，
  以及使用的 SF-01 權限、SF-03 結束交易與 SSE 快照、SF-04 `RANKERS` 與結果輸出。
- [Class](../../diagrams/005-fair-ranking-class.puml)：`activities.mode`、`results`、`rankFair` 的輸入輸出型別與
  暫存的勝出次數、前端 `mode-rules.js`。
- [Sequence：結束公平模式活動](../../diagrams/005-fair-ranking-sequence.puml)：結束交易內的 `rankFair`、
  結果頁、寫回預覽與 CSV 讀同一份結果。
- [Sequence：改選模式與鎖定](../../diagrams/005-fair-ranking-sequence-mode.puml)：準備中改選、授權與驗證、
  階段檢查、SSE 同步，以及改選與開啟並行。

### 後端模組（`src/features/fair-ranking/`）

| 模組 | 職責 |
| --- | --- |
| `fair-ranking.js` | `rankFair(units)`：依 spec.md §4 計算最終順位的同步純函式（契約見 [contracts/fair-ranking.md](contracts/fair-ranking.md)） |
| `modes.js` | `MODES`、`selectMode`：驗證模式值，在交易內確認 `PREPARING` 後更新 `activities.mode` |
| `router.js` | `createFairRankingRouter`：`POST /teacher/activities/:activityId/mode`（見 [contracts/http-api.md](contracts/http-api.md)） |

### 前端模組（`public/`）

| 模組 | 職責 |
| --- | --- |
| `js/mode-rules.js` | `modeLabel`、`modeRule`（固定說明文字）、`renderModeRule`：老師、學生與結果頁共用 |
| `teacher/mode-select.js` | 準備中以單選群組選擇或改選模式；開啟後唯讀並顯示已鎖定；收到階段事件即更新 |
| `student/mode-info.js` | 學生在準備中與搶答中看到模式與規則說明；結束後由結果頁顯示 |

### 跨子功能修改（PR 中請負責人確認）

| 檔案 | 擁有者 | 修改 |
| --- | --- | --- |
| `src/features/results-export/ranking.js` | SF-04 | `RANKERS` 加入 `FAIR: rankFair`，移除「SF-05 之前無法結束」的註解 |
| `src/app.js` | 共用 | 掛載 `createFairRankingRouter`（取消預留的註解） |
| `public/student/realtime-buzzer.js` | SF-03 | 模式改變時也派發 `student-activity-phase`（與教師端以 `status:mode` 為鍵的作法一致；一行條件） |
| `public/js/results-view.js`、`public/teacher/results-export.js` | SF-04 | 結果頁顯示規則說明；寫回預覽與紀錄標示模式；`modeLabel` 改由 `mode-rules.js` 提供並由原模組轉出 |
| `public/teacher/index.html`、`public/student/index.html` | 共用 | 新增 `#mode-select`、`#student-mode` 區塊與模組 |
| `tests/unit/results-export/results.test.js` | SF-04 | 「公平模式無法結束」的測試改為「公平模式結束時保存公平順位」，並以直接呼叫驗證未登錄模式的防護 |

## Project Structure

### Documentation (this feature)

```text
specs/005-fair-ranking/
├── spec.md              # 功能規格（含 Clarifications）
├── plan.md              # 本檔
├── research.md          # Phase 0：設計決策
├── data-model.md        # Phase 1：沿用的資料、計算輸入輸出與 API 資料形狀
├── quickstart.md        # Phase 1：驗證指南
├── contracts/
│   ├── http-api.md      # 模式端點與受影響的既有端點
│   └── fair-ranking.md  # rankFair 契約、演算法與測試向量
├── checklists/
│   └── requirements.md  # 規格品質檢查
├── tasks.md             # Phase 2（/speckit-tasks）
├── diagram-sync.md      # 實作後（/speckit-plantuml-sync）
└── acceptance.md        # 驗收紀錄
```

### Source Code (repository root)

```text
src/
├── app.js                                   # 掛載 SF-05 router
└── features/
    ├── fair-ranking/
    │   ├── fair-ranking.js
    │   ├── modes.js
    │   └── router.js
    └── results-export/ranking.js            # 註冊 FAIR

public/
├── js/
│   ├── mode-rules.js                        # 模式名稱與規則說明（固定文字）
│   └── results-view.js                      # 結果頁顯示規則說明
├── teacher/
│   ├── index.html                           # #mode-select 區塊
│   ├── mode-select.js                       # 準備中改選、開啟後鎖定
│   └── results-export.js                    # 寫回預覽與紀錄標示模式
└── student/
    ├── index.html                           # #student-mode 區塊
    ├── mode-info.js                         # 模式與規則說明
    └── realtime-buzzer.js                   # 模式改變時派發階段事件

tests/
├── unit/
│   ├── fair-ranking/
│   │   ├── fair-ranking.test.js             # AC-21、AC-22 向量與不變式
│   │   └── modes.test.js                    # 階段、驗證、鎖定、與開啟的先後
│   └── results-export/results.test.js       # 公平模式結束與失敗回滾
└── integration/fair-ranking/fair-ranking.test.js
                                             # HTTP 權限、同步、AC-21～AC-23 端到端、重啟、隱私
```

**Structure Decision**: 沿用既有的單一專案結構，SF-05 的後端集中在 `src/features/fair-ranking/`，前端模組依角色放在
`public/teacher/`、`public/student/`，共用的說明文字放在 `public/js/`，測試依 unit／integration 分開。

## Complexity Tracking

沒有違反 constitution 的設計，不需要說明。`results-export/ranking.js` 匯入 `fair-ranking/fair-ranking.js` 是
單向依賴（純函式，沒有循環），符合「跨功能呼叫透過該功能匯出的函式」。
