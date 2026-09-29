# Battery Cover: FreeCAD Parametric Model (PartDesign)

The full reverse-engineered battery cover as a **native FreeCAD PartDesign feature tree**:
- Every sketch is fully constrained.
- Every dimension is driven from one `Params` spreadsheet.

| File | Use |
|---|---|
| `BatteryCover_Parametric.FCStd` | Open directly. It contains the Body, the `Params` sheet and the original mesh (hidden) for overlay. |
| `BatteryCover_PartDesign.FCMacro` | Rebuilds the same document from scratch: **Macro → Macros… → Execute** |

## Feature tree

```
BatteryCover
├── Params                    spreadsheet: 49 named dimensions (mm)
├── Original mesh (source)    hidden; toggle with Space to overlay
└── Body
    ├── Sketch_Plate  → Plate               Pad (Width)            plate + R0.5 top rounds
    ├── Sketch_InnerFrame → InnerFrame      Pad                    side rails, top lip, hook legs, 2 ribs
    ├── Sketch_HookBlock → HookBlock        Pad                    retention hook (1.0 gap to plate)
    ├── Sketch_Bump → Bump                  Pad (midplane)         outer bump, R2 ends
    ├── Sketch_BumpCore → BumpCore          Pocket (midplane)      bump coring, 1.0 walls
    ├── MidPlane                            Datum plane at Width/2
    ├── MirrorBumps                         Mirrored               Bump + BumpCore → other side
    ├── Fillet_BumpEdges                    Fillet R0.25           bump side edges
    ├── Sketch_Latch → Latch                Pad (midplane)         snap latch arm, catch tooth, ramp
    ├── Sketch_LatchSlots → LatchSlots      Pocket                 2 coring slots → 3 ribs
    ├── Sketch_RecessShell → RecessShell    Revolution 180°        thumb-recess shell (2.0 wall)
    └── Sketch_RecessCut → RecessCut        Groove 360°            thumb-recess cut (R7.1 + R1.25 rim)
```

## Editing
1. Open `Params` (double-click).
2. Change a value in column B, for example `Wall`, `Width`, `RibW` or `RecessArcR`.
3. Press **Recompute** (Ctrl+R).

The sketches follow automatically; you don't need to touch them.
Each sketch dimension is an expression such as `=Params.Y_Outer - Params.Wall`. Right-click a constraint to see it.

## Verification (FreeCAD 1.0.2, headless)
- All 10 sketches: **fully constrained**, 0 redundant, 0 conflicting, 0 malformed.
- All 12 features valid; the result is one solid.
- **Identical to `../STEP/battery_cover.step`**: Boolean difference 0.000 mm³ both ways.
- **13 parameter edits**, each recomputed in place and compared with a fresh build using the same value: difference 0.000 mm³ every time. Restoring the value returns the part exactly.
  - Parameters tested: Width, RibW, Rib1X, BumpH, RecessArcR, HookGap, Z_Top, Wall, LatchW, SlotW, BumpX, BumpW, CoreTopY.
- The saved `.FCStd` reopens and recomputes cleanly.

## Notes
- Frame matches the source mesh:
  - X = width
  - Y = thickness, with +Y the cosmetic outer face
  - Z = length
- The top-edge rounds are drawn in `Sketch_Plate` rather than added as a Fillet feature. That keeps them immune to FreeCAD's topological-naming problem.
- `Fillet_BumpEdges` is the only feature that references edges. If a large bump edit ever breaks it, re-select the 12 bump side edges.
- This is the design-intent (flat plate) model. The as-measured 0.34 mm bow is in `../STEP/battery_cover_as_measured.step`.
- Built and tested with FreeCAD 1.0.2; the file opens in 1.1.
