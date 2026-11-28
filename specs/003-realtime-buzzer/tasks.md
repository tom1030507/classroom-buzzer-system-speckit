# SF-03 任務

**分支** `feat/003-realtime-buzzer` · **PR** [#26](https://github.com/tom1030507/classroom-buzzer-system-speckit/pull/26) · **負責人** tom1030507

SF-01 提供工作階段，SF-02 提供已確認匯入及固定的作答單位。T003 使用 T001 的快照與串流及 T002 的受理紀錄，T004 在整合後驗證。

- [x] **T001 [US1／#10]** 驗證空活動、合法階段轉移、過期匯入版本、教師結束確認及結束／送出競態。實作 `src/features/realtime-buzzer/{router,state,events}.js` 的控制路由及 SSE，接入 `src/app.js`。在 HTTP 整合測試核對 10 組與 20 題的開啟時限。（FR-03、FR-04、SC-001、SC-005、AC-04、AC-10）[HTTP 測試](../../tests/integration/realtime-buzzer/realtime-buzzer.test.js)
- [x] **T002 [US2／#11]** 驗證同時間戳序號、同組重送、非法題號／單位、題組成員完整性與交易回滾。實作 `src/features/realtime-buzzer/submissions.js` 及受理識別 migration；在結束後拒絕 POST，在快照保留之前受理資料。（FR-03、FR-04、FR-08、SC-002、SC-003、SC-005、AC-05～AC-08、AC-10、AC-18）[交易測試](../../tests/unit/realtime-buzzer/submissions.test.js) · [受理識別 migration](../../src/db/migrations/003-01-submission-receipts.sql)
- [x] **T003 [US3／#12]** 實作 `snapshots.js` 的兩種角色投影與 `public/js/activity-events.js` 的連線狀態。更新教師及學生 `realtime-buzzer.js`，以純文字呈現答案、固定教師監看焦點，並讓教師的確認匯入跟隨同活動快照。驗證教師權限、兩組資料隔離與暫定勝出邏輯。（FR-03～FR-05、FR-08、SC-002、SC-004、AC-05、AC-06、AC-09、AC-16）[投影程式](../../src/features/realtime-buzzer/snapshots.js) · [HTTP 測試](../../tests/integration/realtime-buzzer/realtime-buzzer.test.js)
- [x] **T004 [#9]** 執行完整 `npm test` 與檔案型 SQLite 重啟測試，記錄 Chromium 使用 Sheets 測試替身的教師與兩組學生驗證。核對四張 PlantUML 圖並留下產圖資訊。（FR-03、FR-04、SC-001～SC-006、AC-04～AC-10、AC-15、AC-16、AC-18、DC-03、DC-05）[驗收紀錄](acceptance.md) · [圖表核對](diagram-sync.md)
- [x] **T005 [US3／#32]** `public/teacher/realtime-buzzer.js` 的「受理順序」改顯示整場受理序號 `acceptSeq`，與結果頁、CSV 一致；以 headless Chrome 搭配試算表替身核對。（FR-05、FR-08）

真實雲端 Sheets 的完整課程流程依[快速驗證](quickstart.md)及 [SF-02 驗收紀錄](../002-sheets-import/acceptance.md)留證。結束狀態與最終結果的同交易實作由 SF-04 #14 接續。
