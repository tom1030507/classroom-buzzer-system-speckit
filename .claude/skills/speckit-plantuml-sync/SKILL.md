---
name: speckit-plantuml-sync
description: Verify the feature's PlantUML diagrams against the implementation, update them and re-render PNGs
compatibility: Requires spec-kit project structure with .specify/ directory
metadata:
  author: classroom-buzzer-system-speckit
  source: plantuml:commands/speckit.plantuml.sync.md
---

# Sync PlantUML Diagrams with the Implementation

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Purpose

`spec.md` DC-03 requires that, after implementation, the code is checked against the diagrams and
that every change is reflected in the diagrams. This command performs that check and records the
evidence.

## Steps

1. **Resolve the feature**: run `.specify/scripts/bash/check-prerequisites.sh --json --paths-only`
   from the repository root and parse `FEATURE_DIR`. Let `FEATURE_NAME` be its basename.

2. **Load**: `diagrams/FEATURE_NAME-*.puml`, `FEATURE_DIR/plan.md`, `FEATURE_DIR/tasks.md`, and the
   implemented code: `src/features/<slug>/`, the feature's modules under `public/`, and the
   feature's migrations `src/db/migrations/<NNN>-*.sql`. If no diagram exists, run
   `/speckit-plantuml-diagrams` first.

3. **Compare** each diagram with the code:
   - Component: every component and dependency exists in code, and no undeclared dependency was
     added (for example a direct import of another feature's repository).
   - Class: entities, fields and relationships match the migrations and modules.
   - Sequence: messages match the real routes, services, events and transaction boundaries.

4. **Resolve differences**:
   - If the code reflects the intended design, update the `.puml` files.
   - If the code deviates from `plan.md` or the specs without a recorded reason, do not silently
     redraw the diagram: list the deviation and ask the user whether to fix the code or amend the
     plan.
   - If the feature changed shared components or the shared schema, also update the matching
     `diagrams/system-*.puml` baseline diagram.

5. **Render** the changed diagrams with `npm run diagrams -- <files>` and make sure each `.png` was
   regenerated.

6. **Record the evidence** in `FEATURE_DIR/diagram-sync.md`: the date, the commit checked, and a
   table `| Diagram | Element | Code location | Status (match / updated / deviation) |`. Report the
   summary to the user so it can be cited in the pull request.