# 順位計算介面（給 SF-05）

`src/features/results-export/ranking.js` 匯出 `RANKERS`，以活動模式為鍵：

```js
// units：依單位固定順序（units.position）排列；每個單位的 submissions 依 accept_seq 由小到大排列
// [{ unitId, submissions: [{ submissionId, groupId, acceptSeq }] }]
// 回傳每筆受理的最終順位（單位內從 1 起算且不重複）
// [{ submissionId, unitId, finalRank }]
```

- SF-04 提供 `SPEED: rankSpeed`：單位內依 `acceptSeq` 給 1、2、3…。
- SF-05 加入 `FAIR`：依根目錄 `spec.md` §4 逐單位計算；可使用 `groupId` 統計此前單位的勝出次數。
- `saveFinalResults` 在結束交易內呼叫 `RANKERS[mode]`，依回傳值寫入 `results`（`is_winner = finalRank === 1`）。
  結果檢視、寫回與 CSV 只讀 `results`，不需要因公平模式修改。
- 計算必須是同步的純函式，不得讀寫資料庫或 `await`（在結束交易內執行）。
