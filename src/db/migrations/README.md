# Database migrations

伺服器啟動時，`src/db/migrate.js` 會依檔名順序套用尚未套用的 `.sql` 檔，
每個檔案各自在一個交易中執行，並在 `schema_migrations` 記錄檔名與 checksum。

## 命名規則

| 檔名 | 用途 |
| --- | --- |
| `000-base-schema.sql` | 共用基礎模型（spec.md §6），由基礎架構建立 |
| `000-patch-<序號>-<描述>.sql` | 基礎模型的後續修正，例如 `000-patch-01-lock-activity-ownership.sql`；`patch` 讓它排在 `000-base-schema.sql` 之後 |
| `<功能編號>-<序號>-<描述>.sql` | 各子功能的擴充，例如 `001-01-sessions.sql`、`004-01-exports.sql` |

功能編號沿用 `specs/NNN-<slug>/` 的編號，兩人平行開發時檔名才不會撞號。

## 規則

- 已合併進 `main` 的 migration **不得修改**。啟動時若 checksum 不符會直接報錯；
  請改為新增一個 migration。
- 開發中還沒合併的 migration 可以修改；本機資料庫會因 checksum 不符而無法啟動，
  此時刪除 `data/buzzer.sqlite*` 後重新啟動即可。
- 不要在 migration 裡寫 `PRAGMA`（交易中無效），也不要寫 `BEGIN`／`COMMIT`。
- 新增欄位用 `ALTER TABLE ... ADD COLUMN`；SQLite 無法替既有表新增外鍵或 CHECK，
  需要時請在 plan 中說明並採用重建資料表的做法。
- 修改其他子功能擁有的資料表前，先在 PR 中取得該子功能負責人同意。

## 資料表擁有者

| 資料表 | 擁有者 | 說明 |
| --- | --- | --- |
| `activities`、`student_groups` | SF-01 | 工作階段、教師設定等欄位或資料表由 SF-01 新增 |
| `units`、`questions` | SF-02 | 匯入確認後整批取代；開啟後由 trigger 鎖定 |
| `submissions`、`submission_answers` | SF-03 | 只在 `OPEN` 可新增，受理後不可修改或刪除 |
| `results` | SF-04（SF-05 擴充公平模式） | 只在 `CLOSED` 可新增，寫入後不可修改或刪除 |
| 匯出紀錄（尚未建立） | SF-04 | 逐題目標、寫入內容與結果 |
