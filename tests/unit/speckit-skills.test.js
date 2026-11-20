import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { PROJECT_ROOT } from '../../src/config.js';

const SKILLS_DIR = path.join(PROJECT_ROOT, '.claude', 'skills');

// `specify extension add --dev` links skills into the git-ignored .specify-dev/ folder,
// which breaks them in every other checkout. Skills must be committed as regular files.
test('Spec Kit skills are committed as regular, loadable files', () => {
  const skills = fs.readdirSync(SKILLS_DIR).filter((name) => name.startsWith('speckit-'));
  assert.ok(skills.includes('speckit-plantuml-diagrams'));
  assert.ok(skills.includes('speckit-plantuml-sync'));

  for (const name of skills) {
    const file = path.join(SKILLS_DIR, name, 'SKILL.md');
    assert.equal(fs.lstatSync(file).isSymbolicLink(), false, `${name}/SKILL.md must not be a symlink`);
    assert.match(fs.readFileSync(file, 'utf8'), new RegExp(`^---\\nname: "?${name}"?\\n`), name);
  }
});
