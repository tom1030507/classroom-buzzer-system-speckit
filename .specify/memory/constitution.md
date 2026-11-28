<!--
Sync Impact Report
- Version change: 1.0.0 → 1.0.1（PATCH：文字澄清）
- Modified principles: I. spec.md 為唯一產品基準（不再寫死版本號；spec.md 已依 §10 更新至 v1.1，v1.2 另以 PR #36 審查）
- Added sections: 無；Removed sections: 無
- Templates: .specify/templates/ 沒有引用 spec.md 版本號，不需修改
- Follow-ups: 無
-->

# 課堂搶答系統（SpecKit 組）Constitution

## Core Principles

### I. spec.md 為唯一產品基準

- 根目錄 `spec.md`（現行版本以文件開頭標示為準）是產品需求與驗收的唯一基準。本 constitution 規範「怎麼做」，
  `spec.md` 規範「做什麼」；兩者衝突時以 `spec.md` 為準。
- 功能開發期間不得修改 `spec.md`。任何變更必須依 `spec.md` §10 辦理：記錄原因、影響的
  FR／AC／DC、更新版本號、同步另一 OpenSpec 小組，並以獨立 PR 經另一位組員 review 後合併。
- 每份 SpecKit 功能規格（`specs/NNN-<slug>/spec.md`）只涵蓋 §9.1 的一個子功能（SF-01～SF-05）；
  其中每條需求與驗收情境都必須標註對應的 FR-xx／AC-xx 編號，能雙向追溯。
- 不得把必做功能降為選配，也不得實作 §10 列為不納入的項目：自動判題、人工改判、帳號註冊、
  同組多人同步編輯、歷史搜尋、公開部署、任意未標記版面辨識。

理由：兩小組的功能必須一致（DC-04），驗收也必須有單一且可追溯的依據。

### II. 後端權威與安全預設

- 狀態轉移、權限、身分、題號／單位與內容驗證一律由後端執行；前端停用按鈕或隱藏畫面，
  都不能取代後端檢查。
- 角色與組別只能由後端驗證過的工作階段識別，不得信任前端傳入的角色、組別 ID 或活動狀態。
- 在 `CLOSED` 之前，學生拿到的頁面、API 回應、SSE 事件與錯誤訊息都不得包含其他組的名單、
  答案、送出狀態、數量、順位或勝出者。過濾必須在後端完成，並以自動化測試證明。
- 服務只綁定 localhost；教師密碼只保存雜湊；工作階段使用不可猜測的 Cookie
  （HttpOnly、SameSite=Strict）；所有變更請求都要驗證 Origin 與 CSRF token。
- 使用者輸入（答案、組名）只能以純文字呈現（`textContent`），不得以 HTML 插入頁面；
  回應標頭必須設定禁止 inline script 的 Content-Security-Policy。
- 機密（服務帳戶憑證、教師設定、工作階段、SQLite 檔）不得進入版控。憑證放在 repository
  之外，以環境變數提供路徑；log、錯誤回應與文件都不得洩漏機密內容。

理由：FR-01、FR-05、AC-09、AC-16 與 §7 的安全要求，都以後端過濾為前提。

### III. 交易完整性與伺服器序列

- 受理送出時的狀態檢查、身分與單位驗證、去重、答案儲存與受理序號分配，必須在同一個
  SQLite 交易內完成。結束活動與送出答案必須經過同一序列處理：在單一 Node.js 程序內以
  同步交易執行，交易內不得 `await`。
- 受理序號由伺服器分配，在活動內唯一且遞增；排序不得採用學生裝置的時間。
- 同組同單位只保留第一筆有效送出；重送一律回傳第一筆紀錄，不得覆寫，也不得新增順位。
- 題組送出是原子操作：全部成員答案、去重與一筆受理序號在同一交易完成，任一步失敗即全部
  不受理。
- 結束狀態與完整結果（含公平模式順位）必須在同一交易保存。結束後的結果不可新增或修改，
  伺服器重啟後也必須不變。

理由：AC-05～AC-10、AC-15、AC-18、AC-21～AC-23 的正確性都依賴這些不變量。

### IV. 直接線上串接 Google Sheets

- 題目匯入必須由後端以服務帳戶，透過 Google Sheets API 直接讀取老師的雲端試算表；勝出答案
  必須寫回同一份試算表的原答案格。不得以 `.xlsx` 下載或上傳、本機檔案、離線樣本或另產答案檔
  代替；CSV 只是額外匯出。
- 題號、題組與答案位置必須從 `{{Q:題號}}`／`{{Q:題號|G:題組代號}}` 標記動態解析，
  禁止寫死題號、題數或儲存格座標。
- 網路、授權或 API 失敗必須明確告知使用者，不得以假資料或樣本冒充成功。寫回採 RAW 純文字，
  寫入前重新讀取並核對原標記，偵測到衝突就停止，並保存逐題匯出紀錄。
- 測試替身只能用在自動化測試，不得取代以真實線上 Sheets 進行的人工驗收。

理由：spec.md §1 明訂必須直接串接雲端 Google Sheets 讀寫，這是本專題的核心驗收點。

### V. 測試先行與真實證據

- 核心邏輯必須先寫自動化測試再實作，至少要在同一個 PR 內完成。範圍包括：排序與公平順位、
  交易與並行、題組、去重、權限與隱私過濾、標記解析與映射、CSV。
- 每個 AC 至少要對應一項自動化測試，或一筆附證據（截圖、log、試算表連結）的人工驗證紀錄，
  並記錄在該功能的 `specs/NNN-<slug>/` 驗收紀錄中。
- PR 合併前 `npm test` 必須全部通過；不得以跳過或刪除測試的方式讓測試通過。
- FR、AC、DC 只有在具備真實證據時才能標記完成；不得虛構 PR、review、驗收或跨組討論紀錄。

理由：spec.md §8 要求自動驗證涵蓋關鍵邏輯，§10 要求每個完成標記都有真實證據。

### VI. 圖表驅動設計（PlantUML）

- 每個子功能在 specification 階段，都必須產生或更新 component、class、sequence 三種
  PlantUML 圖，存放於 `./diagrams/`，命名為 `<功能目錄名>-component.puml`、
  `<功能目錄名>-class.puml`、`<功能目錄名>-sequence[-<情境>].puml`，並以 PlantUML CLI
  （`npm run diagrams`）在同一目錄產生同名 PNG。
- `plan.md` 必須以這些圖表作為設計藍圖並列出引用；計畫中的設計若與圖表不同，必須同步更新圖表。
- 實作完成後必須核對程式與圖表；有差異時，在同一個 PR 內修正圖表並重新產生 PNG。
- `.puml` 與 `.png` 都必須提交版控；PNG 只能由 CLI 產生，不得手動編輯。

理由：DC-03 要求圖表作為 plan 的藍圖，DC-05 要求規格、程式與圖表保持一致。

### VII. 簡單且鎖定的技術棧

- 前端只用 HTML、CSS 與原生 JavaScript（ES modules，無框架、無建置步驟）；後端使用
  Node.js 與 Express；持久儲存使用 SQLite；控制與送出走 HTTP API，狀態與作答同步使用
  Server-Sent Events。
- 相依套件維持最少：`package.json` 鎖定精確版本並提交 `package-lock.json`；新增套件必須在
  該功能的 `plan.md` 說明理由與替代方案。
- 只實作 `spec.md` 範圍內的功能，不預先建構沒有被要求的抽象或設定（YAGNI）。

理由：spec.md §7 指定了技術棧與版本鎖定；兩人協作時，越簡單越不容易衝突。

### VIII. 無障礙與明確回饋

- 表單欄位都要有標籤，所有操作都能用鍵盤完成；狀態與錯誤要用文字表達，不得只靠顏色。
- 連線中斷必須明確顯示；收到伺服器的受理回覆之前，不得顯示「成功」。
- 在 1 位老師、10 組學生、20 題的本機情境下，階段同步與一般送出的回覆目標是 2 秒內；
  Google API 操作要顯示進度與錯誤。

理由：spec.md §7 的可用性與效能基準，以及 FR-03、FR-04 的回饋要求。

## 技術約束與專案結構

- 執行環境：Node.js 26 LTS（最低 24），使用內建 `node:sqlite`；測試使用內建 `node:test`。
- 目錄慣例：
  - `src/features/<功能 slug>/`：各子功能的後端程式（router、service、repository）。跨功能呼叫
    要透過該功能匯出的函式，不直接修改其他功能擁有的資料表。
  - `src/db/`：SQLite 連線、migration 與交易 helper；`src/lib/`：共用的錯誤、log、時間工具。
  - `public/`：前端頁面；各子功能的前端程式放在 `public/<角色>/` 下的獨立模組。
  - `tests/unit/`、`tests/integration/`：自動化測試，檔名為 `*.test.js`。
  - `diagrams/`：PlantUML 原始檔與 PNG；`specs/NNN-<slug>/`：SpecKit 產出。
- 資料庫 schema 以 `src/db/migrations/` 的 SQL 檔管理：`000-base-schema.sql` 是 spec.md §6 的
  共用模型；各子功能以 `<功能編號>-<序號>-<描述>.sql` 新增 migration。已合併進 `main` 的
  migration 不得修改，只能新增。
- 所有時間以 UTC ISO 8601 儲存；錯誤回應格式統一為 `{ "error": { "code", "message" } }`。

## 開發流程與品質關卡

- 子功能編號與目錄固定為：SF-01 `001-activity-groups`、SF-02 `002-sheets-import`、
  SF-03 `003-realtime-buzzer`、SF-04 `004-results-export`、SF-05 `005-fair-ranking`。
- 每個子功能依序執行 `/speckit-specify`（含 PlantUML 圖表 hook）→（建議）`/speckit-clarify`
  → `/speckit-plan` → `/speckit-tasks` →（建議）`/speckit-analyze` → `/speckit-implement`；
  所有產出都存放在對應的 `specs/NNN-<slug>/`。
- 分支從 `main` 建立，命名為 `feat/NNN-<slug>`（修正用 `fix/<描述>`），一律透過 PR 合併，
  不得直接推送 `main`。SF-04 先完成速度模式結果，再由 SF-05 擴充公平模式結果。
- PR 說明必須包含：目的、對應的 SF／FR／AC／任務編號、驗證方式與結果、圖表是否已同步。
  PR 必須由另一位組員實質 review，處理完意見後才能合併。每人至少要有一筆自己提出並合併的 PR，
  以及一筆對另一位組員的實質 review。
- 合併前關卡：`npm test` 通過、Constitution Check 沒有未說明的違規、圖表與程式一致、
  沒有機密進入版控。
- README 分工表只記錄真實的 PR 連結、作者與審閱者；AI 代理的對話紀錄要保留，以供繳交（DC-05）。

## Governance

- 本 constitution 優先於其他開發慣例。每份 `plan.md` 的 Constitution Check 與每次 PR review
  都必須檢查合規；若有違規，須在 plan 的 Complexity Tracking 說明理由，並經另一位組員同意。
- 修訂必須以獨立 PR 提出並附 Sync Impact Report，經另一位組員 review 後才能合併。
- 版本採語意化版本：MAJOR 為移除或重新定義原則；MINOR 為新增原則或實質擴充；PATCH 為文字澄清。
- 涉及產品行為的變更屬於 `spec.md` 的範疇，依原則 I 的變更程序處理，不能只修改 constitution。

**Version**: 1.0.1 | **Ratified**: 2026-11-19 | **Last Amended**: 2026-11-28
