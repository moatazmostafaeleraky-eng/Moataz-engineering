# DFM review: rear case ANRMTPT0002F

Injection-moulding DFM of the reverse-engineered rear case, in the toolmaker report format of
`.claude/skills/dfm-review/SKILL.md`.

- **Report:** `../output/DFM.pptx`
- **DFM-corrected part:** `../output/part_DFM.step`
- **Every number on the slides:** `../output/dfm_summary.json`

## Run

From `base_RE/`:

```bash
python tools/wedges.py      # weak-steel fills -> src/lib/dfm_features.json (needs STL/base.stl)
python src/base_dfm.py      # -> output/part_DFM.step
python dfm/run_dfm.py       # analysis + VTK renders + summary + deck (mesh analysis cached per STEP file)
python dfm/make_deck.py     # rebuild only the deck from output/dfm_summary.json
```

## Files

| File | Role |
|---|---|
| `run_dfm.py` | Part-specific analysis. It reuses `battery_cover_RE/dfm/meshkit.py` (draft, A/B classes, PL edges, sphere thickness, geodesic flow), `mold_calcs.py` (cooling, tonnage, coolant, lifter) and `battery_cover_RE/checks/dfm.py` (straight-pull undercut test). |
| `vtkview.py` | Off-screen VTK renders in the reference look (green part, colour maps, red PL lines, lifter boxes), with a world-to-pixel projector so call-outs land on the features. It needs `libosmesa6` / `libegl1`. |
| `toolmaker_ppt.py` | Deck builder for the house format: 4:3 slides, "N.Topic" titles, CAV/COR indicator, red boxes and labels, and an empty RESULT/APPD/DATE table on every slide. Reusable for the next part. |
| `../src/lib/geometry_dfm.py` | Corrected geometry built on `geometry.py`: side-wall draft, rib draft, weak-steel fills. |
| `../tools/wedges.py` | Finds air gaps under 0.75 mm next to the side walls and fillets. It writes them as fill prisms. |

## Function first (what was deliberately *not* changed)

- **The ten PL catch teeth** (the front-case snap) keep their shape. They are moulded by 10 lifters per cavity. A straight-pull window through the side wall was rejected because it would show on the cosmetic side wall and weaken the snap.
- **The inner side walls inside the four snap stations** keep 0°, so the 0.8 mm front-case slots keep their width.
- **Plates against the side walls and rims at the cover rails** keep 0°, to protect the cover fit and the slots.
- **Ribs under the battery opening** keep 0°. The cavity forms them through the opening, so a core-side taper would be a reverse draft.
- **The contact walls at Z 141–146** are 3.0 mm thick. Coring them is only suggested (battery contact unknown); the STEP is not changed there.

## Labelling

- Fill time, fill map, air traps, weld lines and the ejection-time map are **geometric proxies, not Moldflow**. Each such slide says so.
- Material data are typical ABS datasheet values. The material itself is assumed, because the drawing does not state it.
- Pack time 8 s and mould-open time 5 s are the supplier defaults from the reference reports. Cooling time is calculated.
- Tie-bar distances are typical values. Confirm them against the moulder's machine list.
