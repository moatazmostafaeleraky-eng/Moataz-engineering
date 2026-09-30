---
name: reverse-engineering
description: Mesh-to-CAD reverse engineering in Moataz Mostafa's house workflow. Takes an STL (or any mesh or FreeCAD mesh) and delivers (1) a STEP solid that reproduces the mesh, with a deviation report, and (2) a modified, design-intent part with a full editable feature tree in the user's own CAD program, which it asks for before building the tree. Use for any request to reverse engineer a part, "هندسة عكسية", scan/mesh/STL to STEP, rebuild a part as parametric CAD, give a part a feature tree, or deliver it for CATIA (CATPart / كاتيا).
---

# Reverse engineering: STL → STEP → part with a feature tree

References in this repo:
- **`battery_cover_RE/`** is a simple part, rebuilt fully parametric. It has named constants in `src/lib/geometry.py`, a deviation check and a verified FreeCAD PartDesign tree in `freecad/`. Its accuracy is Hausdorff 0.055 mm.
- **`base_RE/`** is a complex housing. It uses a parametric envelope, 53 ribs rebuilt as "up to skin" sketches, and section-driven detail prisms (`tools/`). Its accuracy is 99.6 % of the surface within ±0.05 mm. `REPORT.md` §2 describes the method.
- Reuse their code. Don't rewrite it.

## Output contract (what the user gets)
1. **`<part>_RE/STEP/<part>.step`**: one valid solid that reproduces the mesh (same frame as the mesh, for 1:1 checks). It comes with:
   - a watertight `STL/<part>.stl`;
   - `checks/deviation_report.json`;
   - `REPORT.md` with images.
2. **The modified part with its feature tree**, in the program the user named. It is the design-intent version: measured values cleaned to design values (round dimensions, symmetric features, scan noise and bows removed unless they turn out to be design intent), plus any change the user asked for. It comes with:
   - every feature named;
   - every dimension driven from one parameter table.
3. Everything committed and pushed to the working branch, and the files sent to the user with `SendUserFile`.

## Step 0: ask for the CAD program before building the tree
- Build and verify the STEP first. Then, **before building any feature tree**, ask with `AskUserQuestion`:
  - "Which CAD program will you edit the part in, and which version?"
  - Options: FreeCAD, SolidWorks, Fusion 360, Onshape, CATIA V5, plus "Other" (NX, Creo, Inventor…).
- Don't guess the program, and don't build a tree for a program the user didn't pick.
- Deliver according to the answer. Be honest about what can be produced and verified in this environment:

| Program | What to deliver | Verification here |
|---|---|---|
| **FreeCAD** | Native `.FCStd` PartDesign Body plus a `Params` spreadsheet. Also a `.FCMacro` that rebuilds it. This is the full native tree (see `battery_cover_RE/freecad/`). | Yes, with headless FreeCAD 1.0.x (`freecadcmd`): sketches fully constrained, one solid, Boolean diff vs the STEP ≈ 0, parameter edits recompute. |
| **SolidWorks** | A VBA macro (`.swp` source, `.bas`) using the SolidWorks API. It creates each sketch and feature with names, drives dimensions from global variables or equations, and ships with a parameter table (`.xlsx` / design table). Also the STEP. | The macro can't be run here. Build the same feature list in FreeCAD or build123d and compare with the STEP, then state that the SolidWorks run is unverified. |
| **Fusion 360** | A Python script (Fusion API, `adsk.core` / `adsk.fusion`) that creates User Parameters, then sketches and features by name. | Same as SolidWorks: mirror-build and compare, and label the Fusion run unverified. |
| **Onshape** | A FeatureScript Part Studio (or a custom feature) with `#variables`. | Same: mirror-build and compare, and label it unverified. |
| **CATIA V5** | `<part>.CATScript`: a macro that builds the native tree and saves `<part>.CATPart`. It creates Length parameters and formulas, offset planes, named sketches, pads and pockets with mirrored extent, shafts and grooves, and mirrors. Generate it with `chat_skills/reverse-engineering/scripts/catia/catia_macro.py` from a feature spec (format in `feature_spec.py`; example `examples/make_cover_spec_example.py`). Also give the STEP (CATIA opens it as the reference body). | The macro can't run here. Mirror-build the same spec with `spec_build.py` and compare it with the STEP: the battery-cover example scored 99.95 % within ±0.05 mm, with the gap only at the manual fillets. Edge fillets and drafts are `manual` steps (they need edge picks). Label it "macro not executed here". A `.CATPart` is written only by CATIA: never claim one was produced. |
| **Other** | The STEP, a numbered feature table (sketch plane, profile, operation, parameters) and a FreeCAD tree as a reference. Offer a script if the program has an API (Inventor iLogic, CATIA VBA, NX Open). | Say exactly what was and wasn't verified. |

- A STEP never carries a feature tree. If the user asks for "the tree in STEP", explain that and deliver the tree in their program.

## Step 1: understand the part before measuring it
- What does the part do in its assembly? Use the assembly drawing and BOM when given (PhotonX sheets).
- Which faces are cosmetic?
- Which faces mate with other parts? For example snap teeth, rails, slots, bosses, openings.
- Write these down. They decide what is design intent and what must not move.

## Step 2: mesh intake
- Load with trimesh and report: watertight, Euler number, bounds, volume, area.
- Keep the source frame (no re-centring) so every check is 1:1.
- Mesh stored inside an FCStd: decode `MeshKernel.bms` (see `battery_cover_RE/REPORT.md` §2).

## Step 3: feature recognition (measure; never guess)
- **Planes:** cluster facets by normal and offset to get every datum.
- **Sections:** at 30+ stations in XY, YZ and XZ. Read the polygon vertices back as exact coordinates.
- **Profiles:** ray-cast them. Use least-squares circle fits for arcs, holes and bosses (report the residual).
- **Revolves:** find the axis by minimising the scatter of height against radius (the finger recess in `base_RE`).
- **Skins:** a spline through ray-sampled points. The wall is a normal offset; check it against the inner skin.
- **Complex housings:**
  - residual = mesh − parametric envelope (mesh booleans with manifold3d);
  - Y-column analysis finds ribs that run "up to the skin" (`base_RE/tools/ycols*.py`);
  - slab decomposition handles the rest (`tools/decomp.py`).
- Note anything that looks like design intent (the battery-cover bow matched the case skin) or a defect in the source (for example an unfused face).

## Step 4: build (build123d via cadgen)
- Put the model in `src/lib/geometry.py` with named constants, and add a `@step` entry script. For a complex part, use data files for measured sketches (`features.json`) and declare them with `cadgen.inputs.declare_input`, or cadgen will skip rebuilds.
- Pick the approach by complexity:
  - **Simple part:** fully parametric, every dimension named.
  - **Housing:** a parametric envelope (skin, walls, ends, openings, revolves, bosses), then "up to skin" rib sketches, then section-driven detail prisms.
- Boolean robustness rules (learned the hard way on `base_RE`):
  - Features that touch the skin overlap about 0.5 mm into the wall. Never leave near-tangent contacts.
  - Snap coordinates per axis (values within 0.02 mm become one value, and flat walls snap exactly). Otherwise 0.01–0.02 mm slits survive inside the solid.
  - Fuse all features first, then cut (openings, slots). Never cut the same surface twice, because coincident revolve faces break the boolean.
  - Fuse many prisms one at a time (`_fuse_seq`) and validate each step when debugging.
  - Keep every polygon valid after rounding: dedupe, `make_valid`, a 0.001 grid.

## Step 5: verify (numbers, not impressions)
- B-rep: valid, **1 solid**, face count, volume and area change against the mesh.
- Two-way surface deviation (60k–120k samples each way): mean, p95, p99, max, % within ±0.05 / ±0.10 mm, Hausdorff, and the worst regions clustered by location. Use `checks/deviation.py` from either reference.
- Section overlays of source against model (`checks/figures.py`) and renders (`cadgen snapshot`).
- A watertight STL export (`src/export_stl.py` handles OCC sliver faces, revolve-axis pinholes and line contacts).
- Tree deliverable: verify as far as the program allows (table in Step 0).

## Step 6: report and deliver
- `REPORT.md` must contain:
  - a summary table;
  - the method;
  - the recovered dimensions (labelled measured);
  - the findings;
  - an **exceptions table** listing where the model is outside ±0.05 mm and why;
  - limitations (for example which features are measured sketches rather than parameters);
  - reproduce commands.
- `README.md`: a short summary with images.
- Commit and push, then send the STEP, the STL and the tree file with `SendUserFile`, plus a one-line summary per file.
- Reply in the user's language (often Egyptian Arabic). Files, code and commits stay in English.

## Honesty rules
- Label every number as measured, hand-calculated or assumed. Never present a proxy as an exact result.
- List every exception, including features that were skipped (for example "bottom-end lip, about 10 mm³, not modelled").
- Never claim a native tree was built or tested in a program that wasn't run. Say "script provided, not executed here".
