# SF-01 任務

## 教師設定與授權

- [x] T001（#3，US1，FR-01，AC-16）以 `scripts/setup-teacher.js`、`password.js`、`sessions.js` 與教師頁實作本機密碼、教師角色、Cookie、Origin 及 CSRF 驗證。

## 活動與組別

- [x] T002（#4，US2，FR-01，AC-04、AC-08、AC-15）以 `activities.js`、`router.js` 與學生頁實作建立活動、加入及重連。`tests/integration/activity-groups/activity-groups.test.js` 驗證身分、加入重試以及重啟。
- [x] T003（#2，FR-01，DC-02、DC-03）對照三張圖表、[資料模型](data-model.md)、[契約](contracts/activity-groups.md)及 [驗收紀錄](acceptance.md)。
- [x] T004（#24 審查，US3，FR-01，AC-04、AC-08、AC-15）在 `activities.js`、`router.js`、`sessions.js` 與學生頁支援退出準備中的活動；HTTP 測試涵蓋只移除本人、原 Cookie 失效、同瀏覽器重新加入、授權及階段限制。
