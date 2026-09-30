---
name: dfm-review
description: Injection-moulding DFM review of a plastic part in Moataz Mostafa's preferred format, a toolmaker-style DFM report (numbered slides, green part renders, red call-outs, OK/NG sign-off table on every slide). Produces a python-pptx deck plus a DFM-corrected STEP, built on the pipeline in battery_cover_RE/dfm. Use for any request to do DFM or DFM analysis, a moldability or manufacturability review, a "DFM PPT", or a part_DFM.step for a moulded part.
---

# DFM review: house style

References:
- **Report format and look:** the four toolmaker DFM reports the user uploaded to the repo root on `main`. Future decks follow this format.
  - `LSP221494_HIDDEN_DISPLAY_HOLDER_DFM_RB_20220503.ppt`: HIPS, 2-plate, 1 × 4, side gate, 7 lifters per cavity, 22 numbered slides.
  - `LSP221495_TERMINAL_HOLDER_DFM_RA_20220505.ppt`: HIPS, 1 × 1, YUDO hot runner with valve gate, 1 slider, 15 PL slides, 18 Suggest slides with customer replies.
  - `LSP221496_ AUX Cover_DFM_RB_20220430 .ppt`: HIPS, 1 × 4, side gate, 22 PL slides, 11 Suggest slides.
  - `LSP221497_AIR_FILTER_DFM_RB_20220430.ppt`: PP, 3-plate, pin-point gate, 8 lifters per cavity.
  - Read them with `soffice --convert-to pptx/pdf` plus `markitdown`, and render slide images, when checking a detail.
- **Analysis engine:** the battery cover ANRMTPT0003F. `battery_cover_RE/dfm/` holds the pipeline and `battery_cover_RE/src/lib/geometry_dfm.py` builds the corrected part. Its 12-slide `output/DFM.pptx` was the earlier format; reuse its analyses and figures, not its layout.

## 0. Before touching geometry: understand the part's function
- Identify what the part does in its assembly. Read the assembly drawing and BOM when given (PhotonX sheets: exploded view, BOM, assembly steps).
- Write down the functional constraints before proposing any change. Examples: a cover must stay closed; cosmetic faces; mating features; snap-fit catches; sealing faces.
- **A DFM fix must never break function.** Lesson from the battery cover: a pass-through window removed the hook lifter but put a hole in a battery cover. That was rejected. The fix was to keep the closed hook and use an angled lifter.
- When the only straight-pull fix changes function or appearance, prefer the tool-side action (lifter or slider), then show the geometry option as rejected, with the reason.
- Ask only when a constraint is genuinely unknowable, such as the mating part's geometry. Otherwise state the assumption on the slide.

## 1. Inputs / outputs
- Input: `input/part.step` (or the file the user names), material (default ABS if unstated, and say so).
- Outputs:
  - `output/DFM.pptx`: toolmaker-style DFM report (§4), python-pptx.
  - `output/part_DFM.step`: corrected, one valid solid.
  - `output/dfm_summary.json`: every number on the slides.
  - `output/figures/`.
- Reuse the repo code; don't rewrite it:
  - `checks/dfm.py` provides `analyze` and `undercut_mask`.
  - `dfm/meshkit.py` provides draft, A/B classes, parting-line edges, sphere thickness, geodesic flow, pin-pad check, section properties and the renderer.
  - `dfm/mold_calcs.py` provides material data and the cooling, tonnage, coolant, bow, beam and lifter calculations.
  - `dfm/make_ppt.py` holds deck helpers (tables, images, charts). Write the toolmaker-format builder on top of them.
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
- Draft: at least the reference defaults (1.0° cavity, 0.5° core). The battery cover used 1° core and 3° on cosmetic cavity walls. Keep parting-line and functional edges (such as catch faces) sharp.
- Radius R ≥ 0.5 on internal corners (rib, rail, lip and boss roots). Fillet in connected groups, because one combined OCC call fails.
- Uniform nominal wall in the 2–3 mm window. Ribs, bosses and snap features at 50–65 % of the wall (the references take 2.0 mm ribs down to 1.2 mm); don't thicken them to 2–3 mm, or the class-A face shows sink. Minimum rib 0.8 mm (short-shot risk below that). Remove sharp or weak steel (under about 1 mm) and tiny steps.
- Build the corrected part as a new geometry module that imports the original model's constants and profiles, following the pattern in `geometry_dfm.py`.
- Verify the result: one valid solid, topology as intended (Euler number), zero-draft and undercut areas, and a fresh render. List every exception honestly on the Suggest slides.

## 4. Report format: toolmaker DFM report (user's reference style)
Match the reference decks' structure and look: image-led, minimal text, one topic per slide. Numbering is continuous after slide 2 ("1.Parting Line" … "N.Cycle Time"), and the number of slides follows the part (21–46 in the references).

| # | Slide title | Content |
|---|---|---|
| 1 | *(no number)* Product information / Tooling information | Two columns split by a thin red vertical line. Headings in red and underlined. Fields written as `Label :- Value`. **Product:** Part Name, Index No, Model, Plastic material, Shrinkage (as a factor: 1.005 for HIPS/ABS, 1.015 for PP), Part Weight (g). **Tooling:** Tooling type (2PLATE / 3PLATE), Hot Runner system (NONE / brand, e.g. YUDO), Gate type (SIDE GATE / VALVE GATE / PINPOINT GATE / SUB GATE), No. of cavities (1 X 4), No. of slider (NONE / nX / CAV), No. of lifters (NONE / nX / CAV), Main insert material (e.g. NAK-80), Mold base material (S50C), Mold base Standard (LKM), Injection machine capacity (xxxT). |
| 2 | Product size *(no number)* | Top and side views with overall L × W × H: red dimension lines, values in red-bordered boxes. |
| 1…n | N.Parting Line (one slide per PL region: 5 for a simple part, 15–22 for complex ones) | Slide 1: side view with the CAV / PL / COR indicator plus both iso views with the PL in red. Following slides: iso of the part, a red box on each local PL or shut-off feature, and a zoom of it in a red dashed frame. CAV/COR indicator top-right. |
| … | N.Slider / N.Lifter | Top view with each lifter or slider shaded (lifters pink/purple, slider tan) and labelled ("Lifter 01", "Slider"), with red block arrows for travel direction. Then a detail slide with a translucent 3-D view of each lifter or slider body. |
| … | N.Ejector | Core-side pin layout. Filled circles coloured and sized per diameter, blades as bars. Legend in red boxes: "EP 4.0 ( 5X )", "EB 6.0 X 1.5 ( 1X )". |
| … | N.Gate | Runner layout for all cavities, a gate zoom in a red dashed frame, the gate size in a box ("6.0 X 1.0", "Ø1.0", "Ø3.0") and a type label ("Cold Runner + Side Gate", "Hot Runner + Valve Gate", "Cold Runner + Pin point Gate"). |
| … | N.Draft angle analysis | Two iso views (cavity side magenta, core side blue) with a ±0.5° vertical legend. Red box: "All Green Surface Are 0º Propose To Add 1.0º For Cavity Side & Draft 0.5º For Core Side". |
| … | N.Thickness mark | Two iso views, rainbow thickness map, legend 0–3.5/4 mm on the right. Red box: "Red surface have thickness mark". |
| … | N.Suggest (one slide per issue) | Part view with a red box on the location, a zoom or section (A–A, B–B) with dimensions in red boxes, labels ("Undercut", "Sharp steel", "Cancel 'R'", "Cut plastic", "Before" / "After"), and a red-bordered comment box in toolmaker phrasing (see the catalogue below). |
| … | N.Mold Layout | Mould-base plan (yellow plates, blue clamp plates, cavity inserts light blue, parts green, cooling/guide details) with dimension boxes: mould W × L, insert W × L, "Mold Top" label. Tonnage in a box ("230 TON") and "Distance between tie rods (HXV) 610 X 560". Red box when upsizing is needed: "Machine size need to change from 75T to 100T". |
| … | N.Fill Time | Fill-time map on all cavities and the runner, with a legend. Bold red boxed result: "Filling time = 1.682sec". |
| … | N.Fill Simulation | Fill-progression frames. Red note "(Press shift + F5 to watch animation )" only if an animation is really embedded. |
| … | N.Temperature at flow front | Colour map with legend and probe labels. |
| … | N.Ejection Temperature | Time-to-reach-ejection-temperature map with legend and probe labels. |
| … | N.Air Traps | Map. Red bold note: "Make air vent around parts" / "Not serious air traps". |
| … | N.Weld Lines | Map. Red bold note: "Visible weld lines" / "Not serious weld line". |
| last | N.Cycle Time | 3-D pie of the four phases, a part/layout image, and the breakdown: "1.Fill time = x.xxxsec", "2.Pack time = 8.0 sec", "3.Cooling time = 15.0 sec", "4.Mold open time = 5.0 sec", then "Cycle time = Fill + Pack + Cooling + Mold open = xx.xxx sec" with the total red and underlined. The references use pack 8 s, cooling 15 s and mold open 5 s as supplier defaults. Replace them with calculated values when the part justifies it, and say so. |

**Suggest catalogue.** These are the issue types the references flag; check every part for each. The wording is the toolmaker's; keep it.
- **Undercut:** "Have undercut, Suggest to add draft 0.5º at core side" / "…add 1.0º at cavity side". Alternatives: "Suggest to cancel undercut and PL make same level", "cancel shape, because of cavity main ins undercut".
- **Slider/lifter direction undercut:** "slider moving direction have undercut, when slider open, slider can't come from part". Show Before / After.
- **Sharp or weak steel:** "Have sharp steel, suggest to modify part, cancel 'R'. Because of core main ins sharp steel, easy broken" and "Weak steel, easy broken" with the steel thickness (e.g. 0.8 mm, 3.87).
- **Thin plastic / filling:** "part have only 0.2mm, its difficult to filling" and "change rib dimension 0.6 to 0.8mm because of short shot".
- **Thickness mark (sink):** "Have thickness mark, suggest to change the all rib's thickness from 2.0MM to 1.2MM" (ribs about 0.6 × wall), with section B–B and dimensions.
- **Small steps:** "make surface 'A' and surface 'B' at same surface for avoid small step".
- **Profile at core side:** "cut plastic 3mm for make profile at core side".
- **Add shape:** "Add shape, suggest to add shape for support gate" (e.g. Ø4.0/Ø3.0 × 0.5 pad under a pin-point gate) and "add shape for support making ejector".
- **Customer replies:** in the references the customer (E-laraby) wrote replies on the Suggest slides as red boxes: reviewer, date, "O.K" or a question ("If it is appliable to use a lifter ??").
  - When we write the DFM, leave RESULT / APPD / DATE and any reply boxes **empty**. Never invent an approval.
  - When the user asks us to review a supplier DFM instead, add replies in that same red-box format.

**Simulation slides:** use real Moldflow/CAE results when the user supplies them. Otherwise generate them from the pipeline:
- flow-length fill map;
- thickness-based cooling/ejection-time map (t_c(s) per face);
- last-to-fill and front-meeting points for air traps and weld lines.

Caption each such slide in small grey text: "estimate, geometric proxy, not Moldflow". Never present a proxy as a simulation.

## 5. Visual style: match the references
- **Page:** 4:3 at 10 × 7.5 in, plain white background, no theme graphics, no footer or page number.
- **Title:** "N.Topic" top-left, Arial about 16 pt, black, regular weight. Slides 1–2 carry no number.
- **Sign-off table:** bottom-left on every slide, 3 × 3, thin grey borders, Arial 9–10 pt, white:
  `RESULT | OK | NG` / `APPD |  |` / `DATE |  |`. Leave it empty for the customer.
- **Part renders:** bright green faces (about `3DBE3D`, lighter on top faces, darker on sides), iso and plan views. Mark areas with red `FF0000` rectangles or circles and red leader lines, and frame zooms with a thin red dashed border. Highlight the feature under discussion in solid red or magenta inside the zoom.
- **Labels:** red-bordered white boxes, Arial 10–12 pt: "CAV", "PL", "COR", "Lifter 01", "Slider", "Undercut", "Before", "After", "Core main ins", dimension values.
- **Pull indicator:** "CAV" box over "COR" box, joined by a red double arrow with a short cross-line for PL, top-right.
- **Comment box:** red border, white fill, centred black text in Arial 11–12 pt. Key results (fill time, cycle total, machine-size change) in bold red.
- **Colour maps:** a vertical legend with a numeric scale on the right. Draft uses magenta (+) through green (0) to blue (−) over ±0.5°; thickness uses rainbow, blue thin to red thick; flow results use rainbow.
- **Text:** minimal, terse toolmaker English. Keep the references' phrasing, including "Suggest to modify part, because of …".
- The red vertical divider on slide 1 is part of the reference style. It is allowed here even though generic deck guidance avoids stripes.
- Build with python-pptx. Tables are native, and the cycle-time pie is a native pie chart.

## 6. QA before delivering
- Run `validate.py` from the pptx skill.
- Render the deck: soffice → PDF → PNG. If Impress is missing, install `libreoffice-impress`.
- Inspect every slide for overflow, overlaps and stale images, then fix and re-render.
- Label proxy simulation slides and hand calculations as such. Label material data as typical datasheet values.
- Check that the sign-off table and the slide numbering are present on every slide, and that no approval or reply box has been filled in on our own DFM.
- Commit the outputs and code to the working branch, then send `DFM.pptx` and `part_DFM.step` to the user.
