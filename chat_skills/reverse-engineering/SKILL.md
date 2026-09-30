---
name: reverse-engineering
description: Mesh-to-CAD reverse engineering for plastic and mechanical parts. Takes an STL (scan or mesh) and delivers (1) a STEP solid that reproduces the mesh, with a deviation report, and (2) a modified, design-intent part with a full editable feature tree in the user's own CAD program, which it asks for before building the tree. Use for any request to reverse engineer a part, "هندسة عكسية", "ريفيرس", scan/mesh/STL to STEP, rebuild a part as parametric CAD, or give a part a feature tree.
---

# Reverse engineering: STL → STEP → part with a feature tree

The user is a mechanical / product-design engineer.
- Reply in the user's language; Egyptian Arabic is common. Keep technical terms, file names and code in English.
- Work in the code-execution sandbox. Bundled code is in `scripts/`.

## What the user gets
1. **`<part>.step`**: one valid solid that reproduces the mesh, in the same coordinate frame as the mesh so the comparison is 1:1. It comes with:
   - a watertight `<part>.stl`;
   - a **deviation report**: mean, max and % of the surface within ±0.05 mm;
   - a **comparison image**: the source mesh next to the CAD model.
2. **A modified part with its feature tree**, in the program the user named. It is the design-intent version: measured values cleaned to design values (round dimensions, symmetric features, scan noise removed), plus any change the user asked for. It comes with:
   - every feature named;
   - every dimension driven from one parameter table.
3. A short summary in chat: accuracy, findings, and **exceptions** (where the model is outside ±0.05 mm and why).

Save every deliverable to the outputs folder and present the files to the user.

## Step -1: check the environment, then pick a path (never stop dead)
Run `python scripts/offline/meshlite.py`, which prints the libraries that import. Try `pip install` once only: a network error means the sandbox is offline, and retrying won't help.

**Full path:** build123d and trimesh are available. Follow Steps 0–5 as written.

**Offline path:** no CAD kernel, so this sandbox can't write a STEP. Use the offline kit in `scripts/offline/` (numpy + Pillow; scipy recommended). Don't ask the user to change settings before delivering something.

| File | Role |
|---|---|
| `meshlite.py` | STL reader, stats (watertight, Euler, bbox, volume, area), `plane_clusters` (datums), `section` (exact polylines), `fit_circle` (with RMS residual), ray caster, `render` (Pillow) |
| `deviation_offline.py` | Two-way deviation between the source STL and a model STL. Validated against the full pipeline: mean 0.0027 vs 0.0024 mm, p95 0.011 vs 0.011 mm |
| `mesh_vs_model_offline.py` | The comparison image: source mesh vs model |
| `step_info.py` | Reads a STEP as text (product name, units, face count, vertex bounding box) |

The offline flow:
1. **Intake and measurement:** as in Steps 1–3, with `meshlite`. Every value is measured on the STL.
2. **Ask for the CAD program now,** not after the STEP. Offline, the STEP is built by the user's CAD from a script you write. Add **NX** to the options: an NX Open Python journal, run with Tools → Journal → Play.
3. **Deliver three things:**
   - the feature table (measured values, residuals);
   - one script for their program that builds the as-measured part **and** the design-intent part from one parameter table;
   - the instructions to run it.

   Label it "script provided, not executed here".
4. **Ask the user to export both parts** as fine STL (chord 0.005–0.01 mm, binary, mm) and as STEP, then send the STLs back. Run `deviation_offline.py` and `mesh_vs_model_offline.py` on them, and report the deviation. Only then call the STEP verified.
5. Offer the other route once: enable network access for code execution (claude.ai → Settings → Capabilities → code execution, allow network egress or package managers; on Team / Enterprise plans an owner controls this). With network access, the STEP is built and verified here.

## Step 0: ask for the CAD program before building the tree
- Build and verify the STEP first. Then, **before any feature tree**, ask one short question:
  - "Which CAD program will you edit the part in, and which version?"
  - Options: FreeCAD / SolidWorks / Fusion 360 / Onshape / NX / Other.
- Don't guess. Build the tree only for the program the user picks.

| Program | Deliver | Verification |
|---|---|---|
| **FreeCAD** | A macro `.FCMacro` that builds a PartDesign Body with fully constrained sketches driven by a `Params` spreadsheet. Build the `.FCStd` too if FreeCAD runs in the sandbox or on the user's linked computer. Pattern: `scripts/examples/freecad_partdesign_tree_example.FCMacro`. | If FreeCAD is available: sketches fully constrained, one solid, Boolean diff vs the STEP ≈ 0. |
| **SolidWorks** | A VBA macro (`.bas` / `.swp` source) using the SolidWorks API: named sketches and features, and dimensions linked to global variables (Equations), plus a parameter table (`.xlsx`). | It can't be run here. Mirror-build the same feature list with build123d and compare with the STEP; say "macro not executed here". |
| **Fusion 360** | A Python script (Fusion API) that creates User Parameters, then named sketches and features. | Same: mirror-build and compare, and label it unverified. |
| **Onshape** | A FeatureScript Part Studio with `#variables`. | Same. |
| **NX** | An NX Open Python journal (`.py`, Tools → Journal → Play) that creates expressions for every parameter, then named sketches and features. | Same as SolidWorks: mirror-build (or, offline, check the user's STL export with `deviation_offline.py`), and label it unverified until then. |
| **Other** | The STEP plus a numbered feature table (plane, sketch, operation, parameters). Offer a script if the program has an API (Inventor iLogic, CATIA VBA, NX Open). | State exactly what was verified. |

- A STEP never contains a feature tree. If the user asks for "the tree in STEP", explain that and deliver the tree in their program.

## Step 1: understand the part first
- What does the part do in its assembly? Use the assembly drawing or BOM if given.
- Which faces are cosmetic? Which features mate with other parts (snaps, rails, slots, bosses, openings)?
- Write this down: it decides what is design intent and what must not move.

## Step 2: environment and mesh intake
- Full path: `pip install build123d trimesh manifold3d shapely scipy rtree matplotlib` (add `vtk` for renders). If the install is blocked, switch to the offline path (Step -1).
- Load the STL and report: watertight, Euler number, bounds, volume, area.
- **Keep the source frame** (no re-centring).

## Step 3: feature recognition (measure; never guess)
- **Datums:** cluster facets by normal and plane offset to get every planar datum.
- **Sections:** at 30+ stations in XY, YZ and XZ (`trimesh.section`). Read polygon vertices back as exact coordinates. `scripts/housing_zoom.py` renders section grids.
- **Profiles:** ray-cast them. Use least-squares circle fits for arcs, holes and bosses, and report the residual.
- **Revolved features** (dimples, finger recesses): find the axis by minimising the scatter of height against radius.
- **Curved skins:** a spline through ray-sampled points. The wall is a normal offset; verify it against the inner skin.
- **Complex housings:**
  1. Build a parametric envelope (skin, walls, ends, openings).
  2. Compute residual = mesh − envelope with mesh booleans (`manifold3d`).
  3. **Y-column analysis** finds ribs that run "up to the skin" (a sketch plus "Extrude up to body", exactly as a designer models them): `scripts/housing_ycols*.py`, `housing_tbuild.py`.
  4. **Slab decomposition** handles the remaining detail: `housing_decomp.py`, then `housing_export_features.py`.
- Note anything that looks like design intent (a "bow" that matches the mating part) or a defect in the source (for example an unfused face).

## Step 4: build (build123d)
- Pick the approach by complexity:
  - **Simple part:** fully parametric, every dimension a named constant. Example: `scripts/examples/geometry_simple_part_example.py`.
  - **Housing:** parametric envelope, then up-to-skin rib sketches, then section-driven detail prisms. Example: `scripts/examples/geometry_housing_example.py`.
- Boolean robustness rules (learned the hard way):
  - Features that touch the skin overlap about 0.5 mm into the wall. Never leave near-tangent contacts.
  - **Snap coordinates** per axis: values within 0.02 mm become one value, and flat walls snap exactly. Otherwise 0.01–0.02 mm slits survive inside the solid.
  - Fuse all features first, then cut (openings, slots). Never cut the same surface twice (coincident revolve faces break the boolean).
  - When debugging, fuse many prisms one at a time and check validity after each.
  - Keep polygons valid after rounding: dedupe, `make_valid`, a 0.001 grid.
- Export with `bd.export_step`.

## Step 5: verify (numbers, not impressions)
- **B-rep:** valid, **1 solid**, face count, volume and area change against the mesh.
- **Two-way surface deviation**, 60k–120k samples each way (`scripts/deviation.py`): mean, p95, p99, max, % within ±0.05 / ±0.10 mm, Hausdorff, and the worst regions clustered by location.
- **Visual checks:** section overlays (mesh filled, model outline) and the comparison image (`scripts/mesh_vs_model.py`, using `scripts/vtkview.py`; if off-screen VTK is unavailable, render with matplotlib).
- **Watertight STL:** `scripts/export_stl.py` handles OCC sliver faces, revolve-axis pinholes and cracks.
- **The tree deliverable:** verify as far as the program allows (table in Step 0).

## Honesty rules
- Label every number as measured, hand-calculated or assumed.
- List every exception, including features that were skipped (for example "edge lip, about 10 mm³, not modelled").
- Never claim a native tree was built or tested in a program that wasn't run. Say "script provided, not executed here".
- Never invent dimensions, materials or tolerances that were not measured or given.
