# Moataz-engineering: working notes for Claude

Engineering portfolio and working repo for Moataz Mostafa: product design, reverse engineering, DFM, CFD and FEA.

- Reply in the language the user writes in (Egyptian Arabic is common). Code, file names, commit messages and deck text stay in English.
- **DFM work:** always follow `.claude/skills/dfm-review/SKILL.md`. That means the toolmaker-style DFM report format (numbered slides, green renders, red call-outs, OK/NG sign-off table), a corrected STEP, the reused pipeline in `battery_cover_RE/dfm/`, and a function-first rule: a DFM fix must never break what the part does.
- **Reverse engineering work:** always follow `.claude/skills/reverse-engineering/SKILL.md`. Deliver the STEP (with a deviation report), then **ask which CAD program the user edits in** before building the modified part's feature tree in that program.
- Reverse engineering reference: `battery_cover_RE/` holds the mesh → parametric STEP, the deviation check, and a FreeCAD PartDesign tree driven by a Params spreadsheet.
- Rear case reference: `base_RE/` holds a large-part RE: a parametric envelope, ribs rebuilt as "up to skin" sketches found by Y-column analysis, and section-driven detail prisms with coordinate snapping (see `base_RE/REPORT.md` §2). Reuse `base_RE/tools/` for complex housings.
- Report results honestly. Label measured numbers, hand calculations and assumptions as such, and list the exceptions.
