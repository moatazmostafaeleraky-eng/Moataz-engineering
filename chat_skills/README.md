# Skills for Claude Chat (claude.ai)

Each folder is one Skill: `SKILL.md` plus `scripts/`, the bundled code Claude runs in its sandbox.

| Skill | Input | Output |
|---|---|---|
| `reverse-engineering` | STL (scan or mesh) | STEP + deviation report + comparison image, then a modified part with its feature tree in the user's CAD program (asked first) |
| `dfm-review` | STEP (or an STL, which goes through reverse engineering first) | `DFM.pptx` (toolmaker-style report) + `part_DFM.step` (corrected, function unchanged) |

## Install
In claude.ai, open Settings → Capabilities → Skills → Upload skill, then choose `reverse-engineering.zip` or `dfm-review.zip`. Each zip holds the skill folder with `SKILL.md` at its top.

## Offline sandboxes (no internet)
Both skills first run `scripts/offline/meshlite.py` to see which libraries are available.

- **Offline DFM:** from an STL, the numpy-only kit writes the analysis, `DFM.pptx` and `DFM_changes.md` (the change list the CAD user applies). `part_DFM.step` needs a CAD kernel, so it is written only when build123d can be installed.
- **STEP-only input:** Claude reads the STEP as text for name, units and size, then asks for an STL export.
- **Offline RE:** Claude measures the STL and writes a build script for the user's CAD (FreeCAD / SolidWorks / Fusion / Onshape / NX). It then checks the user's STL export of that model with `deviation_offline.py`.
- **Full path:** enable network access for code execution in claude.ai settings (on Team / Enterprise plans, the org owner does this).

Version: V1.1 (V1 + offline mode).
