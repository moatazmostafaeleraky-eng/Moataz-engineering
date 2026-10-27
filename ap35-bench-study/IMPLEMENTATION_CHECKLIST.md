# Implementation checklist

Legend:

- **W** = working in the app
- **T** = covered by an automated test (Vitest or smoke)
- **M** = works, but limited by the model or by missing published data
- **—** = not implemented

| Area | Item | Status |
|---|---|---|
| Sources | Official documents S1–S8 downloaded and cited per parameter; discrepancies D1–D6 recorded | W |
| Sources | Parameter status sourced / digitised / calibrated / assumed / supplied shown in UI and PARAMETERS.md | W T |
| Properties | R32 (CoolProp tables), psychrometrics | W T |
| Cycle | Compressor surrogate map, LEV, wet/dry coils, superheat dynamics, liquid carry-over | W T M (compressor internals not published) |
| Cycle | Rated cooling and heating points within 1 % | W T |
| Cycle | Held-out performance table: capacity RMSE 2.1 % | W T |
| Cycle | Catalogue minimum capacity | M (−18 %) |
| Cycle | SHF at rating 0.88 | M (0.84, D6) |
| Cycle | Refrigerant charge / inventory | — |
| Air | Published fan curves, resistance model, filter/fouling effects | W T |
| Air | Vane direction changes distribution, not capacity | W T |
| Air | Outlet geometry edits change airflow and jet | W T |
| Air | Zonal airflow field, jet trace, comfort zones, draft | W T M (approximate, not CFD) |
| Air | Indoor and outdoor air kept separate | W T |
| Room | Air + mass + moisture balances, infiltration, gains, chamber mode | W T |
| Room | Edited room size drawn in 3D | M (thermal model uses it; 3D room stays 4 × 4 m) |
| Control | Supervisor states with reason text | W T |
| Control | PI with anti-windup, ramps, envelope, named limiters | W T |
| Control | 3-minute restart delay, start sequence, sourced protections | W T |
| Control | Defrost (start/finish, fans off, melting) | W T M (start rule and max time assumed) |
| Control | DRY, AUTO, ECONO COOL, NIGHT, i-save, timers, weekly timer, lock | W T M (DRY rule and caps assumed) |
| Control | Fault latch, reset rule, simulated fault codes | W T |
| Control | LEV control on discharge-temperature target | W T M (surrogate) |
| Experiments | Overrides through the same protections; eco cap, turbo, sleep as labelled experiments | W T |
| Profiles | Immutable reference, named copies, undo/redo/revert, changed-parameter count | W T |
| Engine | Fixed 0.1 s step, deterministic seed, snapshots, replay, branch, export/import run | W T |
| Engine | Virtual probes with lag/sampling/noise; solid-cell rejection | W T |
| Compare | A/B from identical states, common scales, ghost jet in 3D | W T |
| Compare | Side-by-side 3D viewports | — (2D slices + ghost line instead) |
| Compare | Counterfactual "why" from a snapshot | W |
| Design | LHS sweep, Pareto, SRC sensitivity, robustness envelope, cache | W T |
| Design | Batch cancel | W T (between runs; hard stop after 2 s inside a run) |
| Evidence | Lab CSV with units, steady calibration, held-out validation, synthetic sample | W T |
| Evidence | Transient calibration | — (visual comparison only) |
| Diagnostics | Signature scoring, ambiguity, next measurement | W T |
| Assistant | Command palette (regex intents), every command maps to a validated action | W T |
| Export | Settings JSON, CSV with units, HTML report, PNG | W T (smoke clicks) |
| 3D | Indoor/outdoor units, part registry with fidelity labels, explode, cutaway, cycle tracers, particles, plume, streamlines, slices, 8 view modes | W T (smoke) M (internals conceptual) |
| 3D | Orthographic drawings with published dimensions only | W |
| UI | Explore / Engineer / Design Lab workspaces, 15 tabs | W T |
| UI | Arabic narration and tours | W T |
| UI | Phone layout | W T |
| UI | Sound | M (synthesised illustration, not dB(A)) |
| Delivery | Production build, zero-dependency server, Windows launcher | W T |
| Delivery | GPU frame-rate measurement | — (no GPU in the build container) |
