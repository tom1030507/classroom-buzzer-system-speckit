# Spec Kit extension: PlantUML Diagrams

本專案自製的 Spec Kit extension，用來落實 `spec.md` DC-03：

| Hook | 指令 | 必跑 | 作用 |
| --- | --- | --- | --- |
| `after_specify` | `/speckit-plantuml-diagrams` | 是 | 產生 component、class、sequence 三種 `.puml` 到 `./diagrams/`，並以 PlantUML CLI 產生 PNG |
| `after_clarify` | `/speckit-plantuml-diagrams` | 否 | 規格釐清後更新圖表 |
| `after_plan` | `/speckit-plantuml-diagrams` | 否 | plan 的設計決策若與圖表不同，同步更新圖表 |
| `after_implement` | `/speckit-plantuml-sync` | 是 | 核對程式與圖表，更新圖表並記錄於 `specs/NNN-<slug>/diagram-sync.md` |

## 安裝與更新

此目錄是 extension 的原始碼；安裝後的副本位於 `.specify/extensions/plantuml/`，
Claude Code skill 位於 `.claude/skills/speckit-plantuml-*`，兩者都已提交版控，clone 後即可使用。

修改指令內容後，在 repository 根目錄重新安裝：

```sh
specify extension add tools/speckit-plantuml --dev --force --priority 5
```

`extension.yml` 中每個 hook 都設定 `priority: 5`（git extension 為 10），
依優先序執行時，圖表會在 git auto-commit 之前產生；git auto-commit 預設為關閉。
安裝時會產生 `.specify/extensions/plantuml/.specify-dev/`（開發模式的暫存副本），
已列入 `.gitignore`。

## 前置需求

需要 PlantUML CLI（含 Java 與 Graphviz）。macOS：`brew install plantuml`；
其他平台請參考 <https://plantuml.com/starting>。產圖指令為 `npm run diagrams`。
