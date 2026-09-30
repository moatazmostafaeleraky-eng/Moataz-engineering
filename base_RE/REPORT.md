# Rear Case ("base"): Reverse-Engineering Report

Source: `source/base.STL`, the rear case of the TE-12XCME handset (part ANRMTPT0002F). It is the case the battery cover (`../battery_cover_RE/`) fits into.
Deliverables: `STEP/base.step` (B-rep solid), `STL/base.stl`, the model code in `src/`, and the extraction tools in `tools/`.

![outer](images/rebuilt_outer_iso.png)
![inner](images/rebuilt_inner_iso.png)

---

## 1. Summary

| Item | Value |
|---|---|
| Part type | Injection-moulded rear case. Curved cosmetic skin, battery bay with cover opening and slot, ribs, side snap tabs, finger recess, two bosses, tongue at the top end. |
| Envelope | 51.0 × 25.9 × 153.0 mm (X × Y × Z) |
| Nominal wall | 2.0 mm (skin and side walls) |
| Source mesh | Closed, watertight, Euler −6. Volume 30,609.5 mm³, area 35,952 mm² |
| Rebuilt model | 1 valid solid, 1,585 B-rep faces. Volume 30,624.9 mm³ (**+0.05 %**), area 35,978 mm² (+0.07 %) |
| **Accuracy** (120k samples each way, measured) | **Mean 0.0074 mm. 99.60 % of the surface within ±0.05 mm, 99.76 % within ±0.10 mm. Hausdorff 0.40 mm** (exceptions in §5) |
| Bounding box | Identical to the source: X 0.62–51.62, Y 0.41–26.28, Z 0.95–153.94 |
| STL | 182,830 triangles, watertight (every edge shared by exactly two triangles) |

---

## 2. Method

The part has hundreds of small internal features on a doubly curved skin. The model is therefore built in three layers, each checked against the source.

1. **Parametric envelope (hand-modelled, named parameters in `src/lib/geometry.py`).**
   - The cosmetic skin is an S-shaped profile along Z: a spline through 40 measured control points, fitted to within 0.015 mm. It is extruded across X.
   - The skin meets the side walls through an R10 rolling ball, with a constant 2.0 wall (inner R8).
   - The open bottom end is a plane tilted 14.8° about X, fitted to the end face.
   - The top end: an end wall at Z 151.44–153.44, and a 2.0 rim standing 0.49 proud around a shallow recess, filleted on both edges.
   - The cover slot runs through the end wall (X 10.62–41.62, down to the rail level Y 20.34). The battery opening continues it through the top wall (Z 88.45–151.44).
   - The finger recess is a surface of revolution about a Y axis at (X 26.12, Z 88.45), which is the middle of the cover edge. The profile is measured, with a flat floor at Y 22.32. The recessed wall keeps the 2.0 thickness as a normal offset.
   - Two bosses sit beside the recess: Ø3, with an R1.05 top blend, and a Ø1 blind hole with a ball end.
2. **Ribs "up to the skin" (data-driven sketches, `features.json → T`).**
   - Each column of material under the skin was classified by ray-sectioning the source along the pull direction (Y).
   - Material that runs continuously up to the skin became a sketch on the plane where it starts: 14 start levels, 53 sketch regions. Each is extruded +Y "up to the skin".
   - That is how a designer models these ribs (Extrude → Up To Body). The rib ends are exact, not staircased.
3. **Remaining detail (data-driven prisms, `features.json → F/G`).**
   - What the first two layers do not explain was decomposed automatically. Z-slabs were used where the section is constant along Z. Runs where the Z-section varies continuously were re-sliced per connected piece along X or Y, whichever needs fewer slabs.
   - Result: 129 added prisms (70 Z, 34 X, 25 Y) and 7 small cuts.
   - Z prisms that touch the curved skin get an extension that follows the skin inside their range. The extension is a Y-sweep trimmed to the band between the skin and the skin lowered by the local drift.
   - Prisms that touch the skin overlap 0.5 mm into the wall, so no faces meet tangentially.
   - All coordinates are snapped per axis: values within 0.02 mm become one value, and flat walls snap exactly. Faces that meet therefore coincide exactly, and no zero-thickness slits are left in the solid.
4. **Verification.** B-rep validity and solid count, volume and area, and two-way surface deviation with the worst regions clustered. Section overlays of the source and the model are in `images/source_vs_rebuilt_sections.png`.

> **Honest labelling.** Layer 1 is a true parametric model: every dimension is a named constant and can be edited. Layers 2 and 3 are **measured sketches**, stored as coordinates in `src/lib/features.json` and replayed as extrudes. They are exact to the source but not dimension-driven. Turning the recurring ribs and tabs into named parameters (for a drawing or a FreeCAD tree) is the next step if the part will be modified. See §6.

### Coordinate frame (identical to the source, for 1:1 comparison)

| Axis | Meaning |
|---|---|
| X | Width, 0.62 → 51.62 |
| Y | Depth / pull direction. Parting line at Y 4.34. Cosmetic skin at the top (Y ≈ 24.3). Bosses reach Y 26.28, the tongue goes down to Y 0.41 |
| Z | Length. Bottom end (slanted) Z ≈ 1. Top end Z 153.94 |

Battery-cover frame = this frame − (10.62, 4.34, 76.94).

---

## 3. Recovered design data (mm, measured)

| # | Feature | Geometry |
|---|---|---|
| 1 | **Skin** | S-profile spline along Z, extruded X 0.62–51.62, R10 side blends, 2.0 wall. It dips 0.31 mm below its chord over the cover span (lowest at Z 107.2); see §4.1. |
| 2 | **Bottom end** | Open. Cut plane normal (0, −0.2543, −0.9671), offset −5.330 (14.8° about X). A thin inner lip on the edge is **not** modelled (§5). |
| 3 | **Top end** | End wall Z 151.44–153.44. Rim 2.0 wide, 0.49 tall, both top edges filleted (measured R≈0.5, modelled R0.45 because the rim is only 0.49 tall). |
| 4 | **Cover slot / battery opening** | X 10.62–41.62. The opening runs through the top wall for Z 88.45–151.44, and the slot runs through the end wall down to Y 20.34. |
| 5 | **Cover rails** | Ledges X 10.62–12.62 and 39.62–41.62 with the top at Y 20.34. Rims X 8.62–10.62 and 41.62–43.62 run up to the skin. |
| 6 | **Finger recess** | Revolved about Y at (26.12, 88.45). Outer floor Y 22.32 flat to r 2.5, rising to the skin at r ≈ 7.6. Wall 2.0 (normal offset). |
| 7 | **Bosses (×2)** | At (X 16.62 / 35.62, Z 81.44). Ø3.0 to Y 26.28 with an R1.05 top blend. Blind Ø1.0 hole from the cavity to Y 24.87, ball end. |
| 8 | **Battery bay** | Two U-troughs (X 15–22 and 30–37, floor Y ≈ 9) and a centre divider (X 22.6–29.6, top Y 15.34 with a notch and a ramp at Z 96–103). Transverse walls at Z 86–96. Contact walls at Z 139–146. |
| 9 | **Ribs** | Fourteen start levels (Y 4.79 … 18.84), mostly 0.8 thick (40 % of the wall), all running up to the skin. They include the arch-shaped rib (X 19.5–32.6, Z 22.8–37.8, semicircular end, with a centre rib) and the E-shaped ribs beside it. |
| 10 | **Side snap blocks** | Against both side walls, running up to the skin: X 2.62–4.22 / 48.02–49.62 from Y 4.79 at Z 14.7–18.7 and 138.6–142.6; X 3.42–4.72 / 47.52–48.82 from Y 5.79 at Z 63.9–69.4 and 102.9–108.5. Small 0.8 × 0.8 catches start at Y 10.5–12.6 at the same stations. |
| 11 | **Tongue** | Below the parting line at the top end: Y 0.41–4.34, Z 151.45–153.45, with a curved lower edge. |

---

## 4. Findings

### 4.1 The battery cover's 0.34 mm "bow" is design intent
The skin of this case dips 0.31 mm below the straight chord across the cover span, with its lowest point Y 24.010 at Z 107.2. The battery cover's outer face dips 0.34 mm, lowest at cover Z 29.84, which is case Z 106.8 and case Y 24.001. The two agree within 0.01 mm. The cover is curved so that it stays flush with the case.

`../battery_cover_RE/REPORT.md` §4.1 had called that bow "not design intent". It has been corrected: the **as-measured cover model is the design-intent model**.

### 4.2 Cover fit check (indicative)
The as-measured cover STL was placed at +(10.62, 4.34, 76.94) and intersected with the rebuilt case (mesh boolean). Total overlap is **1.2 mm³**, in thin contact sheets:
- 0.73 mm³ at the latch / finger-recess end (Z 88–96);
- 2 × 0.2 mm³ along the rails and opening edges (Z 103–153);
- 0.04 mm³ at Z 145.

That is line-to-line contact in the CAD, with no fit clearance, as expected from nominal models. It is not a clash. The minimum clearance and the latch engagement were **not** measured.

### 4.3 Zero draft
As on the cover, the ribs and walls parallel to Y measure 0° draft: rib thickness is constant from root to tip, for example 0.800 mm at every height on the X 25.72–26.52 rib. Draft would be added in a DFM pass (`.claude/skills/dfm-review/`).

---

## 5. Exceptions (where the model is not within 0.05 mm)

Of 120,000 samples each way, 0.24 % deviate by more than 0.10 mm. Clustering them (3–4 mm cells) puts them in these places:

| Where | Max | Cause |
|---|---|---|
| Bottom-end inner lip: a band along the inner edge of the slanted end, Z ≈ 1.6–3.5 | 0.39 mm | A 0.35 mm tapered lip, about 10 mm³ in total. It is left out because the slab decomposition could only produce it as a 0.05 mm staircase that broke the Boolean fuse. It accounts for 219 of the 289 samples above 0.1 mm. |
| Small side tabs at X 3.4–4.7 (Z ≈ 64, 69, 103, 108, 139, 142) | 0.39 mm | Short tab faces misplaced by up to 0.4 mm in the section-driven layer |
| Rib ends at X 14.1 / 38.1, Z 37.7 and 51.9 | 0.40 mm | Short ramp ends reproduced as 0.05–0.25 mm slabs (staircase) |
| Divider ramp (Z 97.7–103.2) | < 0.05 mm | Sloped along Z inside a region the decomposition could only slice in Z, so it is reproduced as fine Z-slabs (visible steps), still within tolerance |
| Curved rib outlines (arch rib, finger-recess blend) | < 0.05 mm | Replayed as fine polygons from the sections: facets are visible in the renders |

Other notes:
- **STEP B-rep:** valid, 1 solid. `src/export_stl.py` closes two sub-0.1 mm tessellation pinholes at the revolve axis of the finger recess; these are a mesher artefact only.
- **Parameters rounded to the measurement:** the rim fillet is R0.45 against a measured ≈0.5. The finger-recess edge blend (≈0.05 mm) is not modelled.

---

## 6. Limitations and next steps

- **Editability.** The envelope, opening, slot, recess, bosses and rim are parametric. The ribs and detail are measured sketches: accurate, but you edit them as coordinates. For a production drawing or a FreeCAD PartDesign tree like the battery cover's, the recurring ribs, tabs and the battery bay should be re-expressed as named features. This model is the reference to check them against.
- **Face count.** 1,585 faces, including the fine slabs and polygon facets in §5. A hand-remodelled version would bring this down to a few hundred.
- **Not done yet:** the Face/Button parts that are also in `source/`.

---

## 7. DFM review (injection moulding)

The toolmaker-format DFM report is `output/DFM.pptx` (24 slides), and the corrected part is `output/part_DFM.step` (1 valid solid). Method and scripts are described in [dfm/README.md](dfm/README.md). ABS is assumed, because the drawing does not state the material.

| Item | As received | DFM part |
|---|---|---|
| 0° faces (< 0.25°) | 16,416 mm² | 11,049 mm². Side walls and interior ribs are drafted; the rest is listed for tool design. |
| Straight-pull undercut outside the lifter zones | 10.4 mm² | 8.5 mm² (small local spots: rim end, bosses, rib ends) |
| PL catch teeth | 10 undercuts | Kept (snap function). 10 lifters / cavity, travel 1.5 mm; every lifter-zone face releases within the travel (ray check). |
| Steel < 0.5 mm (samples of 40k) | 178 | 129. 19 knife-edge wedges against the R8 fillets are filled; the 0.8 mm front-case slots are kept. |
| Mass (ABS) | 32.16 g | 31.88 g |

**Tooling concept** (hand calculations): 2-plate mould, 1 × 2 cavities, cold runner with a Ø1.2 sub gate on the inner side wall at mid-length. The maximum flow length is 130 mm (L/t 65). The clamp force works out at 78 t, but the 310 × 330 mould does not fit between the tie bars of an 80 T machine, so a **100 T** machine is needed. Estimated cycle 28.1 s: cooling 13.4 s calculated, fill 1.67 s estimated, pack and mould-open 8 + 5 s as supplier defaults. The simulation slides are geometric proxies, not Moldflow.

**Function first:** nothing that mates was changed. The snap teeth, the 0.8 mm front-case slots (inner walls stay at 0° inside the four snap stations), the cover rails and rims, and the opening all keep their shape. The ribs under the opening keep 0°, because the cavity forms them.

## 8. Reproduce

```bash
cd base_RE
python src/base.py              # -> STEP/base.step   (about 4 min; cadgen tracks features.json and profile_ctrl.npz)
python src/export_stl.py        # -> STL/base.stl     (watertight)
python checks/deviation.py      # -> checks/deviation_report.json
python checks/figures.py        # -> images/deviation_map.png, images/source_vs_rebuilt_sections.png
cadgen snapshot STEP/base.step images/rebuilt_outer_iso.png --camera=145:35 --width 1400 --height 1000
cadgen snapshot STEP/base.step images/rebuilt_inner_iso.png --camera=-35:-50 --width 1400 --height 1000
```

To regenerate `src/lib/features.json` from the source mesh (about 15 min), run from `base_RE/`, writing to `tmp/`:

```bash
python tools/build_env.py        # envelope + ribs meshes (needs a first T.json; see tools/tbuild.py)
python tools/ycols.py && python tools/ycols2.py && python tools/ycols3.py && python tools/tbuild.py   # rib levels -> tmp/T.json
python tools/decomp.py           # residual -> slabs/prisms
python tools/export_features.py  # -> src/lib/features.json
```

## 9. Files

| File | Content |
|---|---|
| `STEP/base.step` | Rebuilt rear case, 1 solid |
| `STL/base.stl` | Watertight tessellation (0.005 mm chord) |
| `src/lib/geometry.py` | Model: parametric envelope and features, plus the replay of the measured sketches |
| `src/lib/profile_ctrl.npz`, `src/lib/features.json` | Measured skin profile; rib sketches and detail prisms |
| `checks/deviation.py`, `checks/deviation_report.json` | Accuracy check and its result |
| `checks/figures.py`, `images/` | Report figures |
| `tools/` | Extraction pipeline, mesh → sketches |
| `output/DFM.pptx`, `output/part_DFM.step`, `output/dfm_summary.json` | DFM report, corrected part, numbers |
| `src/lib/geometry_dfm.py`, `src/base_dfm.py`, `dfm/` | DFM geometry and pipeline |
| `source/` | Source meshes (base, and the Face/Button parts not yet processed) |
