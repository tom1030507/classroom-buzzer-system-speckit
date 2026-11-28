# SF-05 資料模型

藍圖為 [Class 圖](../../diagrams/005-fair-ranking-class.puml)。SF-05 **沒有新增資料表或 migration**，沿用
`000-base-schema.sql` 的資料；本文件說明模式的規則、計算的輸入輸出，以及 API 與前端的資料形狀。

## 活動模式 `activities.mode`（基礎模型；SF-05 負責選擇與鎖定）

| 項目 | 規則 |
| --- | --- |
| 值 | `SPEED`（預設）或 `FAIR`（資料表 CHECK） |
| 可更改的階段 | 只有 `PREPARING`。`OPEN`、`CLOSED` 時 API 回 409 `INVALID_PHASE`，模式不變 |
| 準備中重新選擇目前的模式 | 成功，沒有變化 |
| 開啟後選回相同的模式 | 一律拒絕（409），不視為成功 |
| 最後防線 | trigger `activities_mode_locked_after_open`：活動不在 `PREPARING` 且模式改變時 ABORT；應用程式仍須先檢查並回傳明確錯誤 |

- 模式在準備中可任意更改多次，最後一次生效；開啟之後整場活動（含結束後的結果、寫回、CSV）都使用開啟時的模式。
- 活動建立時為 `SPEED`（資料表預設值），建立流程不接受模式（SF-01 不修改）。

## 沿用的計算來源

| 資料 | 在公平計算中的角色 |
| --- | --- |
| `units.position` | 公平規則的固定單位順序（`UNIQUE (activity_id, position)`，開啟後由基礎 trigger 鎖定） |
| `submissions.group_id` | 統計各組此前的勝出次數；`UNIQUE (unit_id, group_id)` 保證同組同單位最多一筆，所以題組勝出只算一次 |
| `submissions.accept_seq` | 活動內唯一且遞增的受理序號（`UNIQUE (activity_id, accept_seq)`），勝出次數相同時的排序依據；不因公平計算而改變 |
| `results` | 保存結果：`submission_id`（PK）、`unit_id`、`final_rank`、`is_winner`；`UNIQUE (unit_id, final_rank)`，`is_winner = (final_rank = 1)`；只在 `CLOSED` 新增，之後不可修改或刪除 |

- 公平模式下每個單位的 `final_rank` 是 1..n 的排列（n 為該單位的送出筆數）；與 `accept_seq` 的先後可以不同。
- 沒有任何送出的單位沒有 `results` 列；沒有送出某單位的組在該單位沒有順位。

## `rankFair` 的輸入與輸出

沿用 [SF-04 的順位計算介面](../004-results-export/contracts/ranking.md)；演算法與測試向量見
[contracts/fair-ranking.md](contracts/fair-ranking.md)。

```js
// 輸入：依 units.position 由小到大排列的單位；每個單位的 submissions 依 acceptSeq 由小到大排列
// [{ unitId, submissions: [{ submissionId, groupId, acceptSeq }] }]
// 輸出：每筆送出的最終順位（單位內從 1 起算且不重複）
// [{ submissionId, unitId, finalRank }]
```

## 勝出次數（暫存，不保存）

- 每個組在處理某單位之前，已經在較前面單位拿到第 1 名的次數；結束計算開始時所有組為 0。
- 只存在於 `rankFair` 內部的 `Map<groupId, number>`；結束後由已保存的 `results` 可推得
  （某組在該單位之前 `is_winner = 1` 的單位數），不另外保存，結果頁也不顯示（Clarification）。

## API 資料形狀

- **活動**（`POST …/mode` 的回應，與 SF-01 的 `getActivity` 相同）：
  `{ "id": "…", "joinCode": "…", "status": "PREPARING", "mode": "FAIR", "createdAt": "…" }`
- **請求**：`{ "mode": "SPEED" | "FAIR" }`，不接受其他欄位。
- **快照**（SF-03，不修改）：教師 `activity: { id, status, mode }`；學生 `activity: { id, mode, status }`。
  模式改變時內容改變，SSE 即推送新快照（教師與學生各自過濾，不含其他組資料）。
- **結果檢視 `ResultView`**（SF-04，不修改）：`activity.mode` 為 `FAIR` 時，各單位的 `entries` 依 `rank` 排序，
  每筆同時有 `acceptedOrder`（整場受理序號）與 `rank`（最終順位）、`isWinner`。

## 前端固定文字（`public/js/mode-rules.js`）

| 匯出 | 形狀 | 說明 |
| --- | --- | --- |
| `modeLabel` | `{ SPEED: '速度模式', FAIR: '公平模式' }`（凍結） | 沿用 SF-04 的標示，由 `results-view.js` 轉出以維持既有匯入 |
| `modeRule` | `{ SPEED: string[], FAIR: string[] }`（凍結） | 每個陣列元素是一個段落；公平模式最後一段是簡短範例，只用「某組」等泛稱 |
| `renderModeRule(mode)` | 回傳 `<div>` 包含各段落的 `<p>` | 只以文字節點呈現，不含任何活動資料 |

草稿文字見 [research.md R7](research.md#r7-規則說明是前端固定常數)。
