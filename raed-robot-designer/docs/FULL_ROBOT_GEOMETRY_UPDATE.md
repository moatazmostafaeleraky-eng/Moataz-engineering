# Full Robot Geometry Update

## What changed

This update adds an additive Full Robot Geometry mode without removing or rewriting the existing configuration, engineering, optimization, or export functions.

## Robot classification

The application now separates:

1. **Category / morphology** — the kinematic type that decides which generator is used.
2. **Template / size** — a dimension preset inside the selected category.
3. **Application** — welding, handling, machine tending, or pick-and-place.
4. **End effector** — gripper or welding torch.

Current catalog categories:

- `articulated_6r_industrial` — supported; full parametric 6R generator.
- `articulated_6r_cobot` — cataloged and supported by the same 6R geometry path, but safety validation remains separate.
- `scara_4r` — cataloged, generator pending.
- `delta_3r` — cataloged, generator pending.
- `cartesian_3r` — cataloged, generator pending.

Current 6R templates are `compact`, `medium`, and `long`.

## New API

```text
GET  /api/full-design/categories
POST /api/full-design/optimize
POST /api/full-design/export
```

The optimizer searches independent values for:

- `upper_arm_m`
- `forearm_m`
- `wrist_offset_m`

It checks target reachability with the existing IK implementation and returns explainable candidates. The result is not a global optimum and is not manufacturing approval.

The export endpoint returns a ZIP containing:

- Separate STEP and STL files for the base, six links, six joint housings, and tool flange.
- A complete STEP assembly.
- A complete STL assembly.
- A review-only README.

## Limitations

The generated geometry is a parametric engineering preview. It still needs real motor/reducer interfaces, bearing seats, fasteners, tolerances, cable routing, FEA, dynamic sizing, physical calibration, and safety review before manufacturing.
