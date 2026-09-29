# DFM pipeline: battery cover ANRMTPT0003F (ABS)

| Path | What |
|---|---|
| `input/part.step` | Part under review (the design-intent battery cover from `../STEP/battery_cover.step`) |
| `output/part_DFM.step` | DFM-corrected part, built by `src/battery_cover_dfm.py` → `src/lib/geometry_dfm.py` |
| `output/DFM.pptx` | 12-slide DFM review (python-pptx) |
| `output/dfm_summary.json` | Every number shown in the deck |
| `output/figures/` | Figures used in the deck |

## Run (from the repo root)
```bash
python battery_cover_RE/src/battery_cover_dfm.py          # rebuild output/part_DFM.step
python battery_cover_RE/dfm/run_dfm.py [assembly.pdf]     # analysis + figures + output/DFM.pptx
```
The optional PDF is the TE-12XCME assembly drawing, used for the assembly crop on slide 1.

## Code
- `run_dfm.py`: the orchestrator. It reuses `checks/dfm.py` (`analyze`, `undercut_mask`) and `src/lib/geometry.py` constants.
- `meshkit.py`: STEP to mesh, draft per face, A/B side classes, parting-line edges, inscribed-sphere wall thickness, geodesic flow length, ejector-pad check, section properties, renderer.
- `mold_calcs.py`: ABS data, cooling time, cycle, tonnage table, coolant flow and Reynolds number, thermal bow, beam deflection, lifter stroke.
- `make_ppt.py`: the deck.

## DFM changes in `part_DFM.step`
- **Draft:** 1° on the core (B) side, 3° on the cavity (A) side, 3° on the shut-off.
- **Radii:** R0.5 on rib, rail, lip, recess and bump roots.
- **Ribs:** 0.8 → 1.0 mm.
- **Hook undercut:** the closed hook is kept, because a battery cover must not have a hole. The 1.0 mm gap is moulded by a 10° angled lifter (5 mm travel, about 28 mm stroke), and its face on the hook block has 1° draft along the lifter travel.
- **Nominal wall:** 2.0 mm, unchanged and uniform.

## Limits
- The fill, cooling and warpage results are hand calculations and geometric proxies, not Moldflow results.
- The ABS values are typical datasheet ranges.
