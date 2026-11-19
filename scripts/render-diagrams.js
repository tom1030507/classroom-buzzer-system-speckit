#!/usr/bin/env node
/**
 * Renders PlantUML diagrams to PNG next to their source (spec.md DC-03).
 *
 *   npm run diagrams                                   # every diagrams/*.puml
 *   npm run diagrams -- diagrams/002-sheets-import-*.puml
 *
 * Uses the `plantuml` command on PATH, or `java -jar $PLANTUML_JAR` when PLANTUML_JAR is set.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const patterns = process.argv.slice(2);
const files = resolveFiles(patterns.length > 0 ? patterns : ['diagrams/*.puml']);

if (files.length === 0) {
  console.error('找不到任何 .puml 檔案。');
  process.exit(1);
}

const jar = process.env.PLANTUML_JAR;
const [command, prefixArgs] = jar ? ['java', ['-jar', jar]] : ['plantuml', []];
const result = spawnSync(command, [...prefixArgs, '-tpng', '-charset', 'UTF-8', ...files], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error?.code === 'ENOENT') {
  console.error(
    '找不到 PlantUML CLI。macOS 請執行 `brew install plantuml`；其他平台請安裝 Java 與 PlantUML，' +
      '並把 plantuml 加入 PATH，或設定 PLANTUML_JAR 指向 plantuml.jar（見 README.md）。',
  );
  process.exit(127);
}
if (result.status !== 0) {
  console.error(`PlantUML 結束碼 ${result.status}；請修正上方回報的語法錯誤後重新執行。`);
  process.exit(result.status ?? 1);
}

const missing = files.filter((file) => !fs.existsSync(path.join(ROOT, file.replace(/\.puml$/, '.png'))));
if (missing.length > 0) {
  console.error(`下列圖表沒有產生 PNG：${missing.join(', ')}`);
  process.exit(1);
}
console.log(`已產生 ${files.length} 張 PNG：`);
for (const file of files) console.log(`  ${file.replace(/\.puml$/, '.png')}`);

function resolveFiles(inputs) {
  const resolved = new Set();
  for (const input of inputs) {
    const relative = path.relative(ROOT, path.resolve(input)).split(path.sep).join('/');
    const matches = /[*?[]/.test(relative) ? fs.globSync(relative, { cwd: ROOT }) : [relative];
    for (const match of matches) {
      const file = match.split(path.sep).join('/');
      if (!file.endsWith('.puml')) continue;
      if (!fs.existsSync(path.join(ROOT, file))) {
        console.error(`找不到檔案：${file}`);
        process.exit(1);
      }
      resolved.add(file);
    }
  }
  return [...resolved].sort();
}
