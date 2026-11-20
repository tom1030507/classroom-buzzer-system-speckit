---
name: speckit-plantuml-diagrams
description: Generate or update the feature's component, class and sequence PlantUML diagrams in ./diagrams and render PNGs with the PlantUML CLI
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: classroom-buzzer-system-speckit
  source: plantuml:commands/speckit.plantuml.diagrams.md
---

# Generate PlantUML Diagrams for the Current Feature

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

`spec.md` DC-03 requires Spec Kit to produce three kinds of PlantUML diagrams during the
specification phase — **component**, **class** and **sequence** — stored in `./diagrams/` and
rendered to PNG in the same directory with the PlantUML CLI. `plan.md` uses them as its blueprint,
and they are checked against the code after implementation (`/speckit-plantuml-sync`).

## Steps

1. **Resolve the feature**: run `.specify/scripts/bash/check-prerequisites.sh --json --paths-only`
   from the repository root and parse `FEATURE_DIR` and `FEATURE_SPEC`. If it fails, stop and ask
   the user to set `SPECIFY_FEATURE_DIRECTORY` (for example `specs/002-sheets-import`).
   Let `FEATURE_NAME` be the basename of `FEATURE_DIR` (for example `002-sheets-import`).

2. **Load context** (read-only unless stated):
   - `FEATURE_SPEC` (required); if present, `FEATURE_DIR/plan.md`, `data-model.md` and `contracts/`.
   - `.specify/memory/constitution.md`, especially principle VI and the project-structure section.
   - The root `spec.md` sections that the feature references. **Never modify the root `spec.md`.**
   - The baseline system diagrams `diagrams/system-*.puml`. The feature diagrams MUST reuse the
     same component, entity and state names so the whole system stays consistent.
   - Existing `diagrams/FEATURE_NAME-*.puml` files, if any: update them in place, never duplicate.

3. **Write or update the diagrams** (UTF-8; one diagram per file; each file starts with
   `@startuml <name>` and ends with `@enduml`; no remote `!include`):
   - `diagrams/FEATURE_NAME-component.puml`: the components this feature adds or changes (browser
     pages/modules, Express routers, services, repositories, SSE hub, Google Sheets gateway, SQLite
     tables) and their dependencies. Mark clearly which parts belong to this SF and which are used
     from other SFs.
   - `diagrams/FEATURE_NAME-class.puml`: entities and modules with their key fields and functions,
     relationships with multiplicities, and the spec's constraints (uniqueness, state rules).
   - `diagrams/FEATURE_NAME-sequence.puml`: the main flow of the P1 user story. Add
     `diagrams/FEATURE_NAME-sequence-<scenario>.puml` for other critical flows, such as concurrent
     submissions or failure and conflict paths. Show authorization checks and transaction
     boundaries explicitly.
   - Give every diagram a `title` with the SF id (for example `title SF-02 線上題目匯入 — Component`)
     and note the related FR/AC ids. Use a `note` or `legend` for important invariants.
   - Use the names that will appear in code (`src/features/<slug>/...`, table names from
     `src/db/migrations/`), so the post-implementation sync can compare them.
   - Do not invent requirements; diagrams only visualize what the specs say.

4. **Render the PNGs**: run `npm run diagrams -- diagrams/FEATURE_NAME-*.puml`. Every `.puml` must
   get a `.png` next to it. If PlantUML is not installed, stop and tell the user how to install it
   (see `README.md`); never hand-draw or fake a PNG. If PlantUML reports a syntax error, fix the
   `.puml` and render again until it succeeds.

5. **Reference the diagrams from the spec**: make sure `FEATURE_SPEC` ends with a `## Diagrams`
   section (append it if missing, update it if present) that links every diagram, for example:

   ```markdown
   ## Diagrams

   - Component: [002-sheets-import-component.puml](../../diagrams/002-sheets-import-component.puml)
     ([PNG](../../diagrams/002-sheets-import-component.png))
   ```

6. **Report**: list the created or updated files and the rendering result, and remind the user that
   `/speckit-plan` must use these diagrams as its blueprint.