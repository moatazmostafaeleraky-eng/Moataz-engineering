# Skills for Claude Chat (claude.ai)

Each folder is one Skill: `SKILL.md` plus `scripts/`, the bundled code Claude runs in its sandbox.

| Skill | Input | Output |
|---|---|---|
| `reverse-engineering` | STL (scan or mesh) | STEP + deviation report + comparison image, then a modified part with its feature tree in the user's CAD program (asked first) |
| `dfm-review` | STEP (or an STL, which goes through reverse engineering first) | `DFM.pptx` (toolmaker-style report) + `part_DFM.step` (corrected, function unchanged) |

## Install
In claude.ai, open Settings → Capabilities → Skills → Upload skill, then choose `reverse-engineering.zip` or `dfm-review.zip`. Each zip holds the skill folder with `SKILL.md` at its top.

Version: V1 (initial).
