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

修改指令內容後，在 repository 根目錄重新安裝，**再把 skill 換成實體檔案**後才提交：

```sh
specify extension add tools/speckit-plantuml --dev --force --priority 5
for f in .claude/skills/speckit-plantuml-*/SKILL.md; do cp "$f" "$f.tmp" && mv "$f.tmp" "$f"; done
```

Spec Kit 1.2.1 只能用 `--dev` 安裝本地 extension（本地路徑會被當成目錄名稱，`file://` 網址也不接受），
而 `--dev` 會把 skill 建成指向 `.specify/extensions/plantuml/.specify-dev/` 的 symlink。
這個暫存目錄已列入 `.gitignore`，若直接提交 symlink，其他人 clone 後就讀不到 skill；
`tests/unit/speckit-skills.test.js` 會擋下這種情況。

`extension.yml` 中每個 hook 都設定 `priority: 5`（git extension 為 10），
依優先序執行時，圖表會在 git auto-commit 之前產生；git auto-commit 預設為關閉。

## 前置需求

需要 PlantUML CLI（含 Java 與 Graphviz）。macOS：`brew install plantuml`；
其他平台請參考 <https://plantuml.com/starting>。產圖指令為 `npm run diagrams`。
