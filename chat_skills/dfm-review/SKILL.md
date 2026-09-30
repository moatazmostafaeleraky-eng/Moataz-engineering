---
name: dfm-review
description: Injection-moulding DFM review of a plastic part in a toolmaker-style DFM report format. The output is exactly two deliverables, (1) DFM.pptx, a toolmaker-style DFM report (numbered slides, green part renders, red call-outs, OK/NG sign-off table on every slide), and (2) part_DFM.step, the DFM-corrected CAD part with function unchanged. Use for any request to do DFM or DFM analysis, "ملف DFM", a moldability or manufacturability review, a "DFM PPT", or a part_DFM.step for a moulded part.
---

# DFM review: toolmaker-style report + corrected STEP

The user is a mechanical / product-design engineer.
- Reply in the user's language; Egyptian Arabic is common. Deck text, file names and code stay in English.
- Work in the code-execution sandbox. Bundled code is in `scripts/`:

| File | Role |
|---|---|
| `meshkit.py` | Draft, A/B classes, parting-line edges, inscribed-sphere thickness, geodesic flow, flat-pad check, section properties |
| `mold_calcs.py` | ABS data; cooling, cycle, tonnage table, coolant, bow, beam and lifter calculations |
| `dfm_checks.py` | Straight-pull undercut test (`undercut_mask`) |
| `vtkview.py` | Off-screen green renders and colour maps, with a world-to-pixel projector for call-outs. Needs VTK with OSMesa/EGL; if unavailable, render with matplotlib. |
| `toolmaker_ppt.py` | Deck builder in the format below. `make_deck.py` rebuilds the deck from `dfm_summary.json`. |
| `export_stl.py` | STEP to watertight mesh (handles OCC sliver faces and cracks) |
| `wedges.py` | Finds knife-edge steel next to walls and fillets and writes flat-bottomed fill prisms |
| `examples/run_dfm_example.py` | A complete run on a real housing: lifter release check, ejector placement on flat faces, tie-bar check, weld-line and air-trap proxies, cache. Adapt the part data; don't rewrite. |
| `examples/geometry_dfm_example.py` | How the corrected part was built: side-wall draft with a neutral plane at the PL, tapered ribs, fills, and exclusions for function |

Offline kit in `scripts/offline/` (numpy + Pillow + python-pptx; scipy recommended). No internet or CAD kernel needed:

| File | Role |
|---|---|
| `meshlite.py` | Environment check (`python scripts/offline/meshlite.py`), STL reader, ray caster, undercut, exact inscribed-sphere thickness, steel gap, sections, geodesic flow, weld / air-trap proxies, Pillow renderer |
| `run_dfm_offline.py` | Complete analysis from an STL → `dfm_summary.json`, `figures/`, `DFM_changes.md` |
| `deck_offline.py` | Toolmaker-format `DFM.pptx` from that summary (uses `toolmaker_ppt.py`) |
| `step_info.py` | Reads a STEP as text: product name, units, face / surface counts, vertex bounding box |
| `deviation_offline.py` | Two-way deviation between two STLs (for checking a corrected model the user exported) |

## Step 0: check the environment first, then pick a path (never stop dead)
1. Run `python scripts/offline/meshlite.py`. It prints which libraries import. Don't try `pip install` more than once: if the first install fails with a network error, the sandbox is offline and retries won't help.
2. **Full path:** build123d (or OCP / cadquery) and trimesh import, or install in one try. Use everything below, including `part_DFM.step`.
3. **Offline path:** no CAD kernel. Keep going with the offline kit; don't ask the user to change settings before delivering anything.
   - **Input is an STL:** run it all.
     - `python scripts/offline/run_dfm_offline.py part.stl --pull +y --out <outputs>/dfm --name "<name>" --code "<code>" [--material ABS] [--cavities 2]`
     - then `python scripts/offline/deck_offline.py <outputs>/dfm`.
     - `--pull` is the direction the cavity opens, in the STL frame. If unsure, look at the part (renders from `meshlite.render`) and state the choice.
     - The PL is detected automatically at the maximum silhouette (`--pl` overrides it). Say which one was used.
   - **Input is only a STEP:** a STEP can't be tessellated without a CAD kernel, and a mesh can't be invented. Do two things:
     - run `step_info.py` and report the product name, units, face count and **vertex** bounding box (label them "approximate, from STEP text"; the all-point box includes construction points and overstates the size);
     - ask for an STL export in one short message. **NX:** File → Export → STL, triangle tolerance 0.01 mm, angle tolerance 5°. **SolidWorks:** Save As → STL → Options → Custom, deviation 0.01 mm, angle 5°. **Creo / CATIA / Fusion:** export STL at fine resolution, binary, mm.

       Offer the other route in the same message: enable network access for code execution (claude.ai → Settings → Capabilities → code execution, allow network egress or package managers; on Team / Enterprise plans an owner controls this). With network access the skill also writes `part_DFM.step`.
4. **`part_DFM.step` on the offline path:** it can't be written without a CAD kernel. Deliver `DFM_changes.md` in its place: every change with its location in the CAD frame, the CAD operation, the value and the function check. Say plainly: "part_DFM.step needs a CAD kernel, which isn't available in this sandbox. Apply the change list in CAD, or enable network and I'll build it". Never fake a STEP.
5. Offline numbers are measured on the STL exactly as on the full path. Label them the same way (`S["basis"]` in the summary says how each one was made). They were validated against the full pipeline on a real housing:

   | Metric | Offline | Full pipeline |
   |---|---|---|
   | 0° area | 16,417 mm² | 16,416 mm² |
   | Undercut | 437.1 mm² | 437.0 mm² |
   | Thickness median / p95 | 2.00 / 2.01 mm | 2.00 / 2.03 mm |

Full path only: `pip install build123d trimesh manifold3d shapely scipy rtree python-pptx matplotlib vtk`.

## Output contract (what the user gets)
(Offline path: `DFM_changes.md` replaces `part_DFM.step`, as in Step 0.)
1. **`DFM.pptx`**: the toolmaker-style DFM report (§3–4), with RESULT / APPD / DATE left **empty** for the customer.
2. **`part_DFM.step`**: the DFM-corrected part, one valid solid, with **function unchanged**.
3. Save both to the outputs folder, present them to the user, and add a short chat summary:
   - key findings;
   - what changed in the STEP;
   - what was deliberately **not** changed and why;
   - assumptions (material and so on);
   - exceptions.
- Full path with an STL input: reverse engineer it to a solid first (the `reverse-engineering` skill) so `part_DFM.step` can be built. On the offline path, analyse the STL directly.

## 0. Before touching geometry: understand the part's function
- What does the part do in its assembly? Read the assembly drawing and BOM if given.
- List the functional constraints before proposing any change:
  - cosmetic faces;
  - snap catches;
  - mating slots and rails;
  - openings;
  - sealing faces;
  - a cover that must stay closed.
- **A DFM fix must never break function.**
- If the only straight-pull fix changes function or appearance, use a tool action (lifter or slider) and show the geometry option as **rejected, with the reason**. Examples:
  - a window through a cover plate to remove a lifter was rejected because the cover would have a hole;
  - a window through a cosmetic side wall for a snap catch was rejected.
- Functional faces keep 0° if drafting them would change a mating fit:
  - slots that receive the mating part;
  - rails and rims that locate a cover.
- Ribs under an opening are formed by the **cavity** through the opening. A core-side taper there is a reverse draft.
- A change that depends on an unknown mating part goes on a Suggest slide only, "customer to confirm". Don't change it in the STEP.
- Material: if it is not stated, assume ABS and write "assumed" on slide 1.

## 1. Analysis (all numbers measured or hand-calculated, never guessed)
- **Geometry:** envelope, volume, area, mass, projected area in the pull direction (ray grid).
- **Draft:** per-face `asin(|n·pull|)`, reported in bands (<0.25°, 0.25–1°, 1–3°, 3–80°, >80°), and 0° area by region.
- **Undercuts:** straight-pull ray test on a finely subdivided mesh. For tool actions, verify every undercut face is free **within the real lifter or slider travel**, not along an infinite ray.
- **Thickness:** inscribed-sphere diameter at about 30k samples, plus a 0.7 mm local max-filter. Report min (0.5 %), median, max (99.5 %), a histogram, and the thick spots by location.
- **Steel:** the air gap along each face normal (rays). Report samples under 0.3 / 0.5 / 0.8 mm, and the knife-edge spots by location.
- **Parting line:** A/B face classes and PL edges; describe steps and shut-offs.
- **Gate:** 3–4 candidates, each with geodesic max flow and L/t, computed on the main mesh component. Choose on cosmetic impact, weld lines, fill order and tool cost.
- **Ejection:** round pins on verified flat core faces (eroded-polygon placement), blades on thin flats, none in lifter zones. Report the stroke.
- **Cavities and tonnage:** a table for 1/2/4 cavities, using F = n·(A_part + A_runner)·p·SF. Also check the mould against the machine's **tie bars**. If it doesn't fit, write "Machine size need to change from 80T to 100T".
- **Cooling:** 1-D plate cooling time, cycle time, coolant flow and Reynolds number.
- **Fill, air traps, weld lines:** geodesic proxies. Label them as proxies.

## 2. DFM-corrected STEP rules
- **Draft:** at least 1.0° on the cavity side and 0.5° on the core side.
  - Draft side walls with `bd.draft(faces, Plane(neutral at the PL), angle)` before filleting, so the PL outline doesn't change.
  - Draft thin ribs with `extrude(taper=-angle)`, which keeps the tip and grows the root.
  - Keep PL, catch faces and functional edges sharp.
- **Radii:** R ≥ 0.5 on internal corners. Fillet in connected groups.
- **Walls:** uniform nominal wall of 2–3 mm. Ribs at 50–65 % of the wall; the minimum rib is 0.8 mm.
- **Knife-edge steel** (air gap < 0.75 mm against a fillet): fill it with **flat-bottomed** prisms (`wedges.py`). A domed underside leaves new small undercuts.
- **Verify** the corrected part against the original with the same metrics, side by side:
  - one valid solid;
  - 0° area;
  - undercut **outside the tool-action zones** (must not grow);
  - steel samples under 0.3 / 0.5 / 0.8 mm.
- If a change makes a metric worse, fix the cause before delivering. List every remaining exception on the Suggest slides.

## 3. Report format: toolmaker DFM report (user's reference style)
Match the structure and look of the toolmaker DFM reports the user shares as references: image-led, minimal text, one topic per slide. Numbering is continuous after slide 2 ("1.Parting Line" … "N.Cycle Time"), and the number of slides follows the part (21–46 in the references).

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
- **Customer replies:** in the references the customer wrote replies on the Suggest slides as red boxes: reviewer, date, "O.K" or a question ("If it is appliable to use a lifter ??").
  - When we write the DFM, leave RESULT / APPD / DATE and any reply boxes **empty**. Never invent an approval.
  - When the user asks us to review a supplier DFM instead, add replies in that same red-box format.

**Simulation slides:** use real Moldflow/CAE results when the user supplies them. Otherwise generate them from the pipeline:
- flow-length fill map;
- thickness-based cooling/ejection-time map (t_c(s) per face);
- last-to-fill and front-meeting points for air traps and weld lines.

Caption each such slide in small grey text: "estimate, geometric proxy, not Moldflow". Never present a proxy as a simulation.

## 4. Visual style: match the references
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
- Build with python-pptx (`scripts/toolmaker_ppt.py` has every primitive: title, sign-off table, CAV/COR indicator, red boxes and labels, comment box, image placement with pixel-to-slide mapping, and a native pie chart converted to 3-D).

## 5. QA before delivering
- Validate the pptx (open it back with python-pptx; run a validator if one is available).
- Render the deck to images: `soffice --headless --convert-to pdf`, then PDF to PNG. Inspect every slide for overflow, overlaps, missing call-outs and stale images. Fix, then re-render.
- Check that the sign-off table is on every slide and empty, the numbering is continuous, proxy slides carry the "estimate, geometric proxy, not Moldflow" caption, and material data are labelled typical datasheet values.
- Check that `part_DFM.step` re-imports as one valid solid.
