# SF-02 PlantUML 同步紀錄

日期為 2026-11-19。核對對象為此次 SF-02 實作變更。

- **元件圖**與教師頁、匯入 router、Gateway、parser 及 units 服務吻合。匯入共用 SF-01 的後端教師授權；SF-03 透過 `listQuestionUnits` 取得單位與題號。
- **類別圖**與基礎 migration 的 `units`、`questions` 關聯，以及 router 中以教師工作階段與活動為範圍的記憶體預覽吻合。
- **循序圖**與教師選表、確認 preview ID、資料庫同一交易檢查階段與整批取代的順序吻合。Google 讀取與解析發生在交易之前。

用專案的 PlantUML 腳本產生三張 PNG。系統基準圖既有的依賴與資料模型適用此實作。
