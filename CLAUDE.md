# Moataz-engineering: working notes for Claude

Engineering portfolio and working repo for Moataz Mostafa: product design, reverse engineering, DFM, CFD and FEA.

- Reply in the language the user writes in (Egyptian Arabic is common). Code, file names, commit messages and deck text stay in English.
- **DFM work:** always follow `.claude/skills/dfm-review/SKILL.md`. That means the toolmaker-style DFM report format (numbered slides, green renders, red call-outs, OK/NG sign-off table), a corrected STEP, the reused pipeline in `battery_cover_RE/dfm/`, and a function-first rule: a DFM fix must never break what the part does.
- Reverse engineering reference: `battery_cover_RE/` holds the mesh → parametric STEP, the deviation check, and a FreeCAD PartDesign tree driven by a Params spreadsheet.
- Report results honestly. Label measured numbers, hand calculations and assumptions as such, and list the exceptions.
