---
name: dfm-review
description: Injection-moulding DFM review of a plastic part in Moataz Mostafa's house style. Produces a 12-slide python-pptx deck plus a DFM-corrected STEP, built on the reference pipeline in battery_cover_RE/dfm. Use for any request to do DFM or DFM analysis, a moldability or manufacturability review, a "DFM PPT", or a part_DFM.step for a moulded part.
---

# DFM review: house style

The reference implementation is the battery cover ANRMTPT0003F (TE-12XCME remote):
- `battery_cover_RE/dfm/` holds the pipeline (see its `README.md`).
- `battery_cover_RE/src/lib/geometry_dfm.py` builds the corrected part.
- `output/DFM.pptx` and `output/part_DFM.step` are the approved result.

Every new DFM job follows this style unless the user asks otherwise.

## 0. Before touching geometry: understand the part's function
- Identify what the part does in its assembly. Read the assembly drawing and BOM when given (PhotonX sheets: exploded view, BOM, assembly steps).
- Write down the functional constraints before proposing any change. Examples: a cover must stay closed; cosmetic faces; mating features; snap-fit catches; sealing faces.
- **A DFM fix must never break function.** Lesson from the battery cover: a pass-through window removed the hook lifter but put a hole in a battery cover. That was rejected. The fix was to keep the closed hook and use an angled lifter.
- When the only straight-pull fix changes function or appearance, prefer the tool-side action (lifter or slider), then show the geometry option as rejected, with the reason.
- Ask only when a constraint is genuinely unknowable, such as the mating part's geometry. Otherwise state the assumption on the slide.

## 1. Inputs / outputs
- Input: `input/part.step` (or the file the user names), material (default ABS if unstated, and say so).
- Outputs:
  - `output/DFM.pptx`: 12 slides, python-pptx.
  - `output/part_DFM.step`: corrected, one valid solid.
  - `output/dfm_summary.json`: every number on the slides.
  - `output/figures/`.
- Reuse the repo code; don't rewrite it:
  - `checks/dfm.py` provides `analyze` and `undercut_mask`.
  - `dfm/meshkit.py` provides draft, A/B classes, parting-line edges, sphere thickness, geodesic flow, pin-pad check, section properties and the renderer.
  - `dfm/mold_calcs.py` provides material data and the cooling, tonnage, coolant, bow, beam and lifter calculations.
  - `dfm/make_ppt.py` builds the deck.
- Adapt only the part-specific parts:
  - the feature labels (`region()`);
  - the gate candidates and the chosen gate;
  - the lifter or slider data;
  - the ejector-pin grid;
  - the section cut positions;
  - the geometry module for the corrected part.

## 2. Analysis (all numbers measured, never guessed)
- **Geometry:** envelope, volume, area, mass, projected area in the pull direction.
- **Draft:** per-face `asin(|n·pull|)`. Report before and after in bands (<0.25°, 0.25–1°, 1–3°, 3–80°, >80°).
- **Undercuts:** straight-pull ray test. For tool actions, verify every undercut face is free within the actual lifter or slider travel, not an infinite ray.
- **Thickness:** inscribed-sphere diameter at about 30k samples, plus a 0.7 mm local max-filter to remove the under-read at edges. Report min (0.5 %), median, max (99.5 %) and a histogram.
- **Parting line and surface:** A/B face classes and the PL edges. Show section rasters with air colour-coded: A (blue), B (orange), trapped undercut (red), lifter-formed (purple).
- **Gate:** 3–4 candidates, each with geodesic max flow length and L/t. Choose on cosmetic impact, weld lines, fill order of critical features (snap arms fill first, not last), and tool cost.
- **Ejection:** round pins on verified flat pads (disc ray test), kept out of lifter zones. Report the stroke.
- **Cavities and tonnage:** a table for 1/2/4/8 cavities, using F = n·(A_part + A_runner)·p·SF, the standard machine size, shot weight, and parts per hour.
- **Cooling:** 1-D plate cooling time, cycle time, channel layout, heat load, coolant flow and Reynolds number.
- **Fill:** geodesic banded fill map, last-to-fill point, vents, weld lines.
- **Warpage and deflection:** thermal bow per K of A/B ΔT, shrink range, section I, a 10 N mid-span beam check.

## 3. DFM-corrected STEP rules
- Draft: 1° on core-side walls, 3° on cavity or cosmetic walls, 1° on faces along a lifter or slider travel. Keep parting-line and functional edges (such as catch faces) sharp.
- Radius R ≥ 0.5 on internal corners (rib, rail, lip and boss roots). Fillet in connected groups, because one combined OCC call fails.
- Uniform nominal wall in the 2–3 mm window. Ribs, bosses and snap features at 50–65 % of the wall; don't thicken them to 2–3 mm, or the class-A face shows sink.
- Build the corrected part as a new geometry module that imports the original model's constants and profiles, following the pattern in `geometry_dfm.py`.
- Verify the result: one valid solid, topology as intended (Euler number), zero-draft and undercut areas, and a fresh render. List every exception honestly on slide 12.

## 4. The 12 slides (fixed order)
1. Info: dark title slide, part renders, key stats, assembly-drawing crop, findings.
2. PL / PS
3. Draft
4. Undercut, with the slider/lifter options table (selected / rejected, with reasons)
5. Thickness, with a native column chart
6. Gate location and type
7. Ejection
8. Cavities and machine tonnage
9. Cooling
10. Fill sequence
11. Warpage and deflection, with a native XY chart
12. Changes before / after, with open items

## 5. Visual style (keep identical)
- 16:9 at 13.333 × 7.5 in.
- Palette:
  - dark slate `1F2A36` for titles and the title-slide background;
  - steel blue `4C78A8` for the A side;
  - amber `F28E2B` for the B side and accents;
  - red `D62728` only for problems;
  - green `2E8B57` for passes;
  - purple `9467BD` for lifter-formed faces;
  - light card `F3F5F8`.
- Fonts: Cambria for titles (28 pt) and big stats; Calibri for body text (11–14 pt).
- Each slide has a one-line italic key message under the title and an amber rounded section tag top-right ("04  UNDERCUT").
- Footer: "<part code> <name> · <material> · DFM review · Rev NN" plus "n / 12".
- Native python-pptx tables and charts for tabular data. Speaker notes on every slide give the method and assumptions.
- No accent lines under titles, no edge stripes, no text-only slides.
- Figures: trim whitespace, use plan views for gates and pins, and use cadgen snapshots of the current STEP. Regenerate them after any geometry change; don't reuse stale renders.

## 6. QA before delivering
- Run `validate.py` from the pptx skill.
- Render the deck: soffice → PDF → PNG. If Impress is missing, install `libreoffice-impress`.
- Inspect every slide for overflow, overlaps and stale images, then fix and re-render.
- Present fill, cooling and warpage as hand calculations or geometric proxies, not Moldflow. Label material data as typical datasheet values.
- Commit the outputs and code to the working branch, then send `DFM.pptx` and `part_DFM.step` to the user.
