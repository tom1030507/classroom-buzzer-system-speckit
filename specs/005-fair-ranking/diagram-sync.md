# SF-05 圖表同步紀錄

核對日期為 2026-11-20，對照 commit `b06e261` 的實作與系統基準圖。沒有偏離 plan.md 或規格的實作：實作中唯一的設計調整
（模式端點掛在全域 JSON 解析之後，不另設 8 kB 上限）已記錄在 [research.md R4](research.md#r4-模式選擇端點)
與 [contracts/http-api.md](contracts/http-api.md)，不影響圖表。下表的 updated 是核對時發現的細節，同步補進圖表。

| 圖表 | 核對項目 | 程式位置 | 狀態 |
| --- | --- | --- | --- |
| Component | 教師模式選擇：準備中改選、開啟後鎖定，監聽 `teacher-activity`、`teacher-activity-phase` | `public/teacher/mode-select.js` | match |
| Component | 學生模式與規則，監聽 `student-activity`、`student-activity-phase`、`student-activity-closed` | `public/student/mode-info.js` | updated |
| Component | 共用的 `modeLabel`、`modeRule`、`renderModeRule`（固定文字） | `public/js/mode-rules.js` | match |
| Component | 結果頁顯示規則說明；寫回預覽與紀錄標示模式 | `public/js/results-view.js`、`public/teacher/results-export.js` | match |
| Component | 學生端模式改變時也派發 `student-activity-phase` | `public/student/realtime-buzzer.js` | match |
| Component | `createFairRankingRouter`：`POST /teacher/activities/:activityId/mode`，由 `app.js` 掛載 | `src/features/fair-ranking/router.js`、`src/app.js` | match |
| Component | `MODES`、`selectMode`（`withTransaction`、`getActivity`） | `src/features/fair-ranking/modes.js` | match |
| Component | `rankFair` 純函式，由 SF-04 `RANKERS.FAIR` 匯入 | `src/features/fair-ranking/fair-ranking.js`、`src/features/results-export/ranking.js` | match |
| Component | 只使用 SF-01 的 `requireTeacher`、`requireMutation`、`getActivity`、`withTransaction`，沒有未宣告的依賴 | `router.js`、`modes.js`（import 行） | match |
| Component | SSE 快照含 `activity.mode`，每 250 毫秒重組 | `src/features/realtime-buzzer/events.js`、`snapshots.js` | match |
| Component | 結果頁、寫回與 CSV 只讀 `results` 與 `activities.mode`（不修改） | `results.js`、`csv.js`、`sheets-export.js` | match |
| Class | `activities.mode`、trigger `activities_mode_locked_after_open`、`results`（`UNIQUE (unit_id, final_rank)`）、`submissions.accept_seq`，SF-05 不新增 migration | `src/db/migrations/000-base-schema.sql` | match |
| Class | `rankFair` 的輸入輸出型別與暫存的勝出次數（`Map`） | `src/features/fair-ranking/fair-ranking.js` | match |
| Class | `MODES`、`selectMode`，錯誤碼 `INVALID_MODE`（400）、`INVALID_PHASE`（409） | `src/features/fair-ranking/modes.js` | match |
| Class | `RANKERS : { SPEED, FAIR }` | `src/features/results-export/ranking.js` | match |
| Class | 前端 `modeRule` 為字串陣列、`renderModeRule(mode)` | `public/js/mode-rules.js` | match |
| Sequence：結束公平模式活動 | 結束交易內 `saveFinalResults` → `RANKERS["FAIR"]` → `rankFair` → INSERT `results`，失敗整個回滾 | `state.js`、`results.js`、`ranking.js`、`fair-ranking.js` | match |
| Sequence：結束公平模式活動 | 結果頁、寫回預覽、CSV 讀同一份 `results`，`acceptedOrder` 與 `rank` 分開 | `results-export/router.js`、`csv.js`、`sheets-export.js` | match |
| Sequence：改選模式 | 授權與 Origin／CSRF、模式值驗證（400）、交易內階段檢查（409）、UPDATE `mode` | `router.js`、`modes.js` | match |
| Sequence：改選模式 | 與開啟並行：同一序列，只有一種結果 | `modes.js`、`realtime-buzzer/state.js` | match |
| Sequence：改選模式 | SSE 每 250 毫秒推送；學生端派發 `student-activity-phase` 後 `mode-info.js` 更新 | `events.js`、`public/student/realtime-buzzer.js`、`mode-info.js` | match |
| Sequence：改選模式 | 另一個教師分頁的選擇區也由 `teacher-activity-phase` 更新 | `public/teacher/mode-select.js` | updated |
| system-component | SF-04 的 `ranking.js` 匯入 SF-05 的 `rankFair`，原圖畫成 SF-05 → SF-04 | `src/features/results-export/ranking.js` | updated |
| system-component | SF-05 依賴 SF-01（教師權限、活動）；原圖畫成 SF-05 → SF-03，實際沒有匯入 SF-03 | `src/features/fair-ranking/router.js`、`modes.js` | updated |
| system-component | SF-05 經 `withTransaction` 更新 `activities.mode`（→ SQLite） | `src/features/fair-ranking/modes.js` | match |
| system-class、system-sequence | 沒有新增或修改共用資料表；`mode` 鎖定備註、`results` 與流程中的 SF-05 步驟 | `000-base-schema.sql` | match |

以 `npm run diagrams -- diagrams/005-fair-ranking-component.puml diagrams/005-fair-ranking-sequence-mode.puml diagrams/system-component.puml`
重新產生 3 張 PNG。
