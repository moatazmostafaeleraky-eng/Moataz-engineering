# AP35 Live Inverter Bench Study: Complete Build Specification

**What this document is:** everything needed to rebuild the *AP35 Live Inverter Bench Study* from scratch with the same behaviour and the same results. It covers the sources, the data to extract, every equation, every control rule, the software architecture, the 3D scene, the user interface, the calibration, the tests with their acceptance limits, and delivery. The appendices contain the full parameter register and all published tables used.

**What it builds:** an interactive engineering simulator of the **Mitsubishi Electric MSZ-AP35VGK** indoor unit and **MUZ-AP35VG** outdoor unit (R32, 3.5 kW cooling / 4.0 kW heating). It runs in the browser as one coupled system covering the room, air distribution, refrigeration cycle, inverter control and performance, with a live 3D model.

> **ملخص بالعربي:** الملف ده فيه كل اللي محتاجه علشان تبني نفس البرنامج بالظبط:
> - المصادر والداتا اللي تتاخد منها
> - المعادلات وقواعد الكنترول
> - شكل الكود والواجهة والـ 3D
> - طريقة المعايرة والاختبارات وشروط قبولها
> - طريقة التسليم
>
> الملاحق في الآخر فيها كل الـ parameters وكل الجداول المنشورة.

---

## Contents

1. [Ground rules](#1-ground-rules)
2. [Sources and discrepancies](#2-sources-and-discrepancies)
3. [Published data to extract](#3-published-data-to-extract)
4. [Technology stack and project layout](#4-technology-stack-and-project-layout)
5. [Refrigerant and moist-air properties](#5-refrigerant-and-moist-air-properties)
6. [Parameter registry and profiles](#6-parameter-registry-and-profiles)
7. [Component models](#7-component-models)
8. [Steady-state solver](#8-steady-state-solver)
9. [Dynamic plant step](#9-dynamic-plant-step)
10. [Room model](#10-room-model)
11. [Air distribution model](#11-air-distribution-model)
12. [Controller](#12-controller)
13. [Simulation engine](#13-simulation-engine)
14. [Action schema](#14-action-schema)
15. [Scenarios](#15-scenarios)
16. [Batch tools](#16-batch-tools)
17. [Calibration and validation](#17-calibration-and-validation)
18. [Workers and data flow](#18-workers-and-data-flow)
19. [3D scene](#19-3d-scene)
20. [User interface](#20-user-interface)
21. [Tests and acceptance criteria](#21-tests-and-acceptance-criteria)
22. [Delivery](#22-delivery)
23. [Known limitations to carry forward](#23-known-limitations-to-carry-forward)
24. [Build order](#24-build-order)
- Appendices A–D: parameter register, fan/sound data, frequency curves, performance table

---

## 1. Ground rules

These rules drive every design decision. Break one and the product loses its credibility.

1. **Separate data from assumptions from results.**
   - Every parameter carries a status:
     - `sourced`: read from an official document; cite the page.
     - `digitised`: read off a published curve.
     - `calibrated`: fitted to published data.
     - `assumed`: an engineering assumption, not published.
     - `supplied`: a scenario input.
     - `computed`: derived.
   - The UI shows the status next to the value.
2. **Never invent specifications.**
   - If a value is not published, mark it `assumed` and say so in the UI.
   - Do not attribute functions to the product that it does not have. For example, POWERFUL and LONG exist only on AP60/71, so the AP35 build does not offer them as original functions.
3. **The reference profile is immutable.** All experiments are named copies that store only their changed parameters, with undo, redo and revert.
4. **Every change must show up in the physics.**
   - Changing compressor Hz, fan rpm, LEV opening or vane angle must change the computed results and the display.
   - Vane *direction* alone must not create capacity (see §7.3).
5. **Every visible button works**, or it is disabled with a reason in its tooltip.
6. **Honest labelling.**
   - Airflow views say "Approximate airflow model, not CFD validation".
   - The app states that it is an independent study, not a Mitsubishi Electric product.
   - Fault codes are simulator codes (`SIM-…`), not manufacturer codes.
7. **Determinism.** A fixed time step and a seeded RNG mean that the same inputs give the same results. Replay must reproduce the state exactly.

---

## 2. Sources and discrepancies

### 2.1 Official documents (download these first)

All documents are from the Mitsubishi Electric UK library.

| Id | Document | Number / revision | Use |
|---|---|---|---|
| S1 | [MSZ-AP R32 product information sheet](https://library.mitsubishielectric.co.uk/pdf/download_full/3699) | download 3699, April 2021 | rated capacity and power, airflow (l/s), sound, dimensions, charge, pipe limits |
| S2 | [Indoor service manual MSZ-AP25-71VG(K)](https://library.mitsubishielectric.co.uk/pdf/download_full/3963) | OBH788, revised edition B | specification p.6, outline p.11, refrigerant diagram p.18, microprocessor control p.21–28 (section 9) |
| S3 | [Outdoor service manual MUZ-AP25-71VG(H)](https://library.mitsubishielectric.co.uk/pdf/download_full/3965) | OBH789, revised edition A | specification p.6, outline p.11, refrigerant diagram p.18, performance curves p.21–23, performance data p.29–30, actuator control p.40, service functions p.41, troubleshooting p.47–48 |
| S4 | [Indoor parts list](https://library.mitsubishielectric.co.uk/pdf/download_full/3973) | OBB788 B | indoor exploded parts |
| S5 | [Outdoor parts list](https://library.mitsubishielectric.co.uk/pdf/download_full/3975) | OBB789 A | compressor KVB073FYXMC, 4-way valve, LEV, stop valves, reactor, cabinet |
| S6 | [Document index MSZ-AP35VGK](https://library.mitsubishielectric.co.uk/pdf/model_search?model_query=MSZ-AP35VGK) | — | document list |
| S7 | [Document index MUZ-AP35VG](https://library.mitsubishielectric.co.uk/pdf/model_search?model_query=MUZ-AP35VG&scope=all) | — | document list |
| S8 | [Operation manual MSZ-AP25-50VG(K)](https://library.mitsubishielectric.co.uk/pdf/download_full/3970) | JG79Y415L01 | user-facing remote functions |

Secondary sources are used only as plausibility checks, **never as model inputs**:

- **X1:** a supplier listing of the sibling compressor KNB073 (7.3 cm³/rev).
- **X2:** the Mitsubishi rotary compressor catalogue, which confirms the family is rolling-piston rotary.

Inspect tables with merged columns visually. Automated PDF text extraction mixes up the AP25/35/42 columns.

### 2.2 Discrepancies found, and how they are resolved

| Id | Field | Resolution |
|---|---|---|
| D1 | Indoor airflow, heating, High | Use **534 m³/h** (S2 p.6, merged AP25/35 column; S1 gives 148 l/s = 533 m³/h). The value 564 m³/h belongs to the AP42 column. |
| D2 | Heating min–max capacity | S1 gives 4.0 (1.6–4.3) kW; S3 p.6 gives 4.0 (1.3–4.6) kW. Use S1 for the catalogue range and report S3 as a discrepancy. |
| D3 | Rated compressor frequency | Not published as a number. Read it from the S3 p.23 correction curves where factor = 1.0: about **84 Hz cooling, 95 Hz heating** (±2 Hz). |
| D4 | Indoor fan power step | 19 W cooling / 26 W heating "at rated frequency". The ratio matches the cube of the Super High rpm ratio (970 vs 1070), so both are taken at Super High. This is an inference; mark the parameter calibrated. |
| D5 | Regional airflow listings | Do not mix regional retailer data with the UK E1 data (82–190 l/s, 294–684 m³/h). |
| D6 | SHF at rated cooling | The data imply SHF 0.88 at 684 m³/h and 3.5 kW. That needs leaving air above saturation (about 102 % RH). Keep the physics: the model reports about 0.84, and the sensible-capacity column is fitted with reduced weight. |

Store these as a machine-readable register (`src/config/sources.ts`) and show them in the app under **Assumptions & sources**.

---

## 3. Published data to extract

| Data | Source | Notes |
|---|---|---|
| Rated cooling | S1, S3 p.6 | 3.50 kW / 0.99 kW input at indoor 27 DB / 19 WB °C and outdoor 35 DB / 24 WB °C. SHF 0.88, dehumidification 0.6 L/h. |
| Rated heating | S1, S3 p.6 | 4.00 kW / 1.03 kW at indoor 20 °C and outdoor 7 DB / 6 WB °C |
| Catalogue ranges | S1 | cooling 1.1–3.8 kW; heating 1.6–4.3 kW (S3: 1.3–4.6) |
| Indoor fan rpm–airflow, 5 steps, cool and heat | S2 p.6 | Appendix B |
| Indoor sound per step | S2 p.6 | Appendix B |
| Outdoor fan rpm–airflow | S3 p.6 | Appendix B |
| Frequency-correction curves (cool cap / input, heat cap / input) | S3 p.23 | digitised, Appendix C |
| Cooling performance table, 357 rows | S3 p.29–30 | Appendix D |
| Dimensions | S2 p.11, S3 p.11 | indoor 798 × 299 × 219 mm; outdoor 800 × 550 × 285 mm; outdoor fan centre 302.5 mm from the left and 280 mm above the base; foot bolt pitch 500 mm |
| Control sequences and thresholds | S2 §9, S3 §10–12, p.40–48 | see §12 |
| Component identities | S4, S5 | compressor KVB073FYXMC, fan motors RC0J30-CV / RC0J50-NC, 4-way valve 21S4, LEV with 12 V DC coil, capillary 4.0 × 2.4 × 240, stop valves 6.35 / 9.52, reactor L61 18 mH, thermistors RT11/12/61/62/65/68 |

---

## 4. Technology stack and project layout

### 4.1 Stack

- **Language:** TypeScript 5.6, `strict`.
- **Build:** Vite 5.4.11, ES2022 target, `base: './'` (relative paths, so the build runs under any sub-path), `worker.format: 'es'`.
- **3D:** Three.js 0.170: OrbitControls, RoomEnvironment, RoundedBoxGeometry.
- **Tests:** Vitest 2.1.8 (`tests/**/*.test.ts`, timeout 120 s). Browser smoke test with Playwright and Chromium.
- **Properties:** CoolProp, used offline only, to generate the R32 table (Python script).
- **Runtime dependencies:** none apart from `three`. Use no UI framework; write a tiny DOM helper `h(tag, attrs, ...children)`.

### 4.2 `package.json` scripts

```json
{
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview --port 4173",
  "serve": "node serve.mjs",
  "test": "vitest run",
  "calibrate": "vite-node scripts/calibrate.ts",
  "validate": "vite-node scripts/validate.ts",
  "smoke": "node e2e/smoke.mjs",
  "docs": "vite-node scripts/gen_docs.ts"
}
```

### 4.3 `tsconfig.json` (key options)

- `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`
- `lib: [ES2022, DOM, DOM.Iterable, WebWorker]`
- `strict`, `resolveJsonModule`, `isolatedModules`, `noEmit`
- `types: [vite/client, node]`
- `include: [src, tests, scripts/*.ts]`

### 4.4 Folder layout

```
src/
  props/      r32.ts (+ r32_tables.json), psychro.ts
  config/     sources.ts, published.ts, registry.ts, calibration.json, profiles.ts
  model/      types.ts, components.ts, steady.ts, plant.ts, airfield.ts, validation.ts
  control/    controller.ts
  sim/        schema.ts, engine.ts, scenarios.ts, runner.ts, doe.ts, evidence.ts,
              diagnostics.ts, explain.ts, assistant.ts, export.ts, worker.ts
  scene/      kit.ts, indoorUnit.ts, outdoorUnit.ts, airflowViz.ts, viewTypes.ts, app3d.ts
  ui/         styles.css, dom.ts, bridge.ts, state.ts, i18n.ts, charts.ts, ph.ts,
              circuit.ts, features.ts, app.ts, tabs.ts, extras.ts
  main.ts
tests/        physics.test.ts, control.test.ts, experiments.test.ts
scripts/      gen_r32_tables.py, calibrate.ts, validate.ts, gen_docs.ts
e2e/          smoke.mjs
public/       .nojekyll
serve.mjs, start-windows.bat, dev-windows.bat, index.html, vite.config.ts
```

**Units convention:**

- SI throughout: °C, Pa absolute, J/kg, kg/s, W.
- Airflow in m³/h at the fan.
- Compressor "operational frequency" Hz is treated as mechanical rev/s (assumption A1).
- Electrical Hz = pole pairs × mechanical rev/s, with 2 pole pairs assumed. It is used for display only.

---

## 5. Refrigerant and moist-air properties

### 5.1 R32 tables (`scripts/gen_r32_tables.py`, CoolProp HEOS::R32)

Align the tables with the saturation boundary, so interpolation never crosses the two-phase dome.

**Axes:**

| Axis | Range | Step |
|---|---|---|
| `T_sat` | −50…75 °C | 0.5 K |
| `T_level` (pressure levels) | −50…72.5 °C | 2.5 K |
| `dSH` superheat | 0…160 K | 2.5 K |
| `dSC` subcooling | 0…50 K | 2 K |

**Properties per axis:**

- Saturation arrays: P, ρl, ρv, hl, hv, sl, sv.
- Superheated grid at each pressure level: h, s, ρ versus superheat. The first column is saturated vapour.
- Subcooled grid at each pressure level: h, ρ versus subcooling.

**Check points (P, T):** (1.1 MPa, 20 °C), (2.8 MPa, 80 °C), (0.9 MPa, 5 °C), (3.2 MPa, 95.3 °C), (2.0 MPa, 40 °C).

**Reference state:** CoolProp default (IIR).

**Output:** about 262 kB of JSON with a `meta` block that holds the backend version, validity range and critical point.

**Runtime API (`r32.ts`):**

- `psat(T)`: interpolate in ln P.
- `tsat(P)`: binary search on ln P.
- `satProps(T)`
- `vapour(Tsat, dSH)` and `liquid(Tsat, dSC)`: bilinear.
- `superheatFromS(Tsat, s)` and `superheatFromH(Tsat, h)`: binary-search inversion along the superheat axis.
- `stateFromTsatH(Tsat, h)`: returns phase plus quality. Quality is defined **only inside the dome**.
- `dome()`: for the P-h plot.
- `domainFlags`: set when a lookup leaves the table.

### 5.2 Psychrometrics (`psychro.ts`, ASHRAE Fundamentals ch.1)

Constants: P_atm 101 325 Pa; cp,da 1006; cp,v 1860; h_fg0 2.501 × 10⁶; h_fus 333.4 × 10³; cp,w 4186; cp,ice 2100 J/(kg·K); R_da 287.042.

| Function | Definition |
|---|---|
| `pws(T)` | Hyland–Wexler, over water for T ≥ 0 and over ice below |
| `w` | 0.621945 · pw / (P − pw) |
| `h` | 1006 T + w (2.501 × 10⁶ + 1860 T) |
| T from h and w | (h − w h_fg0) / (cp,da + w cp,v) |
| `rh` | capped at 1 |
| `wFromWB` | standard ASHRAE relation, with an ice branch |
| `wetBulb`, `dewPoint` | bisection |
| `specVol` | R_da (T + 273.15)(1 + 1.607858 w) / P |
| `cpMoist` | 1006 + 1860 w |
| `hCondensate(Ts)` | cp,w Ts above 0 °C; −h_fus + cp,ice Ts below |

---

## 6. Parameter registry and profiles

### 6.1 `registry.ts`

Each parameter is a `ParamDef` with these fields:

- `key`, `label`, `value`, `unit`
- `status` (§1)
- `origin`: source and page, or the reason for an assumption
- `range`: [lo, hi]
- `note`
- `group`: product, compressor, control, fans, coils, refrigerant, protection, louvers, room, airflow, sensors, …
- `editable`:
  - `locked`: a published value; experiments cannot change it.
  - `model`: a supported model change.
  - `geometry`: visual-only.

`defaultValues()` builds the reference `ProfileValues`. Calibrated values are read from `calibration.json` at build time. The full register (158 parameters) is in **Appendix A**.

### 6.2 Profiles (`profiles.ts`)

- **Reference:** `mitsubishi_ap35_reference` is frozen with `Object.freeze`.
- **Experiments:** `ExperimentProfile = { name, overrides: Partial<ProfileValues>, history[], future[], kind? }`.
- **`setParam`:** rejects `locked` keys and values outside the range, and pushes to `history` for undo.
- **Other functions:** `revertParam`, `changedParams` (shows reference → experiment and the status badge), `undo`, `redo`.
- **Persistence:** browser `localStorage` under key `ap35-bench.v1`, version 1. If the stored data is unreadable, move it to `ap35-bench.v1.corrupt-backup`, load defaults and tell the user.

---

## 7. Component models (`model/components.ts`)

### 7.1 Fans

- **Curves:** merge the published cooling and heating rpm–airflow points into one curve per fan; they agree within 1 %.
- **Airflow at the reference resistance:** interpolate in rpm. Outside the table, use affinity scaling (q ∝ rpm) and flag `extrapolated`.
- **Resistance changes:** the fan curve is `dp = P0(1 − (Q/Qf)²)`; the system curve is `k·r·Q²`. With the published point at Q/Qf = φ when r = 1:
  ```
  flowRatio(r, φ) = sqrt( a / (max(0.05, r) + φ² a) ),   a = 1/(1−φ²)
  ```
- **Indoor fan:**
  ```
  q = q_ref(rpm) · flowRatio(r, ifanPhi)
  dp = (ifanDpRef / (684/3600)²) · r · (q/3600)²
  P = ifanPbase + dp·(q/3600)/ifanEta
  ```
- **Outdoor fan:** same structure, with reference 2178 m³/h at 940 rpm and `P = ofanPref · (dp·q)/(dpRef·qRef)`.

### 7.2 Outlet free area and indoor resistance

```
outletArea = outletW · outletH · max(0.02, vaneOpen) · vaneF · wideF
vaneF = 1 − 0.25·max(0,(a−55)/35)² − 0.1·max(0,(5−a)/15)²   (a = vane angle, clamped −10…90)
wideF = 0.82 + 0.18·cos(wide angle)
r_filter = resFilterShare·(1 + filterRestriction)
r_coil   = resCoilShare·(1 + 1.5·coilFouling)
r_outlet = resOutletShare·(A_ref / A)²        (A_ref = reference geometry at 30°, wide 0, open)
r_total  = r_filter + r_coil + r_outlet        (shares 0.25 / 0.45 / 0.30 → r = 1 at the published test)
```

The reference area is computed from the **unchanged default profile**, so editing outlet geometry really changes the resistance.

### 7.3 Coils: bypass factor / apparatus dew point

- **Air side at a uniform surface temperature Ts:** BF = exp(−UA_air / (ṁa·cp)).
  - **Dry** (wsat(Ts) ≥ w_in): Q = ṁa·cp·(1−BF)·(T_in − Ts).
  - **Wet:**
    ```
    Qt = ṁa(1−BF)(h_in − h_s(Ts))
    w_out = wsat(Ts) + BF·(w_in − wsat(Ts))
    ṁ_cond = ṁa (w_in − w_out)
    Q_coil = Qt − ṁ_cond · hCondensate(Ts)
    ```
- **`solveCoil(air, ṁa, UA_air, UA_ref, Tr)`:** finds the Ts at which air-side heat equals UA_ref·(Ts − Tr).
  - Dry analytic guess: `Ts = (A·T_in + UA_ref·Tr)/(A + UA_ref)`, with A = ṁa·cp·(1−BF).
  - If that guess is wet, use Illinois false position on F(Ts) = Q_coil(Ts) − UA_ref·(Ts − Tr). Stop at |F| < 0.5 W or after 40 iterations.
- **Air-side UA:** `UA = UA_air,ref · (q/q_ref)^uaExp · (1 − 0.5·fouling)`, with uaExp = 0.6.
  - The outdoor coil also multiplies by 1/(1 + frost/frostRef).
  - Reference airflows are 684 m³/h indoor and 2178 m³/h outdoor.
- **Superheat area:** `f_sh = shFracMax · SH/(SH + 15)` reduces the evaporator's refrigerant-side UA by (1 − f_sh).

### 7.4 Compressor: rolling-piston rotary surrogate (internals not published)

```
PR    = Pc/Pe
ηv    = clamp(0.3, 0.98, ηv0 − ηv,pr·(PR−1) − ηv,low·20/max(5,f))
ṁ     = ηv · ρ_suction · Vd · f
h2s   from isentropic superheat at Tc
lo    = max(0,(fOpt−f)/fOpt),   hi = max(0,(f−fOpt)/fOpt)
ηis   = clamp(0.2, 0.85, ηis,peak·(1 − ηis,pr·(PR/PRopt − 1)²)·(1 − ηis,lo·lo²))
ηmi   = max(0.3, ηmotorInv·(1 − ηis,hi·hi²))        (field-weakening loss above fOpt)
W_shaft = ṁ·max(1, h2s − h1)/ηis
Q_shell = fShell·W_shaft          (to outdoor air)
W_ref   = W_shaft − Q_shell
h2      = h1 + W_ref/ṁ
P_elec  = W_shaft/ηmi + P_inv,fixed
```

### 7.5 LEV + capillary

```
ṁ_LEV = Cv · opening · sqrt(2 ρ_liquid(Tc, subcool) · (Psat(Tc) − Psat(Te)))
```

The opening is shown in % only, because the pulse count is not documented.

### 7.6 Suction state and cycle evaluation

- **Superheated suction:** with xSuct = 1, use superheat = SH_evap + tPickup (line pickup).
- **Two-phase suction:** with xSuct < 1, take h, s and ρ from the lever rule at Te.
- **`evalCycle(P, f, Te, Tc, SH, xSuct, detail)`:**
  - Set Tc,eff = max(Tc, Te + 0.5) and h3 = liquid(Tc, subcool).
  - Calculate:
    ```
    Q_evap,ref = ṁ(h1e − h3)
    Q_pickup   = ṁ(h1 − h1e)
    Q_cond,ref = ṁ(h2 − h3)
    ```
  - With `detail` set, return full state points p1e, p1, p2, p3 and p4 (T, P, h, s, phase, quality) for the P-h diagram and probes.
- **Liquid carry-over (flooding):** the compressor pumps saturated vapour; the entrained liquid evaporates in the shell.
  ```
  ṁ_tot = ṁ_vap / xSuct
  h2    = (ṁ_vap·h2,vap + (ṁ_tot − ṁ_vap)·hl) / ṁ_tot
  ```
  This lowers the discharge temperature and is energy-consistent. There is no power spike.

---

## 8. Steady-state solver (`model/steady.ts`)

**Inputs:** mode, f, indoor and outdoor air states, fan rpm, and optionally SH (default shTarget), filter, fouling, frost and outlet-area ratio.

**Method:** nested bracketed false position (Illinois).

- **Inner loop:** solve Te on [−35, min(T_evapAir − 0.2, Tc − 1)] so that `solveCoil(evap).Q_coil = Q_evap,ref`. Tolerance 0.5 W.
- **Outer loop:** solve Tc on [T_condAir + 0.3, 72] so that `−solveCoil(cond).Q_coil = Q_cond,ref`.

**Outputs:**

- **Cooling:** Q_net = coil Q_total − indoor fan power; Q_sens = coil Q_sens − fan power.
- **Heating:** Q_net = −cond Q_total + fan power.
- **Power:** P_total = P_comp + both fans + P_controls.
- **Core residual:** (Q_cond,air − (Q_evap,air + Q_pickup + W_ref)) / Q_cond,air.

This solver is the reference for calibration and validation, and the dynamic plant must settle to it.

---

## 9. Dynamic plant step (`model/plant.ts`)

`plantStep(P, state, cmd, env, faults, dt, defrosting, detail)` is a pure function of its inputs. Integrate with explicit Euler and dt = 0.1 s. Order inside one step:

1. **Actuators:**
   - Compressor: first-order with τ = 1.5 s. It starts at ≥ 5 Hz, and stops when the command is 0 and fAct < 2.
   - Fans: rate-limited (ifanRampRate, ofanRampRate). A seized fan decays fast.
   - LEV: slew eevRate %/s.
   - Vanes: slew vaneRate / wideRate. Vane open/close 2.5 s; 4-way valve 1 s.
2. **Fans on resistance curves:**
   - Jet angle = 0.65·upper + 0.35·lower.
   - Outdoor resistance r = 1 + 1.5(frost/frostRef)² + 1.2·outdoorFouling.
   - Flag affinity extrapolation.
3. **Refrigerant roles:** with the 4-way valve at 0 (cool), the evaporator is indoor; at 1 (heat), it is outdoor.
4. **Cycle (if running):**
   - ṁ_LEV from the LEV model.
   - **Flooding:** if SH ≤ 0.01 and ṁ_LEV > ṁ_comp, then xSuct = max(0.8, 1 − 0.6(ṁ_LEV − ṁ_comp)/ṁ_comp).
   - Then call `evalCycle`.
5. **Coils:**
   - Use `solveCoil` at each coil node temperature, with the refrigerant-side UA reduced by the superheat fraction on the evaporator.
   - Stopped fan: natural convection, 6 W/K indoor and 12 W/K outdoor (assumed).
   - Compressor off: equalisation heat Q_eq = gEq·(T_out,coil − T_in,coil)·(0.3 + LEV opening).
6. **Coil node energy balances** (lumped metal + refrigerant hold-up):
   ```
   C_in·dT_in/dt   = Q_air,in  ± Q_ref
   C_out·dT_out/dt = Q_air,out ± Q_ref
   ```
   The evaporator loses Q_evap,ref and the condenser gains Q_cond,ref.
7. **Frost and melt:**
   - Frost accumulates when the outdoor coil surface is below 0 °C (ṁ_cond·dt).
   - It melts when the coil is ≥ 0 °C and frost is present, using the excess heat: melt = min(frost, Q·dt/h_fus).
8. **Indoor water film:**
   - Condensate builds a film up to filmMax; the excess goes to the drain tray (`condensateL`).
   - With a dry coil and an existing film, the film re-evaporates: rate = min(film/dt, reEvapK·ṁa·(wsat(T_sup) − w_sup)). Supply w and T are updated at constant enthalpy.
   - Water is never deleted.
9. **Fan heat:** the cross-flow blower sits downstream of the coil, so T_sup += P_ifan/(ṁa·cp).
10. **Superheat dynamics:**
    - Running: dSH/dt = shK·(ṁ_comp − ṁ_LEV)/0.0135, clamped 0…40 K.
    - Off: SH decays with τ = 60 s.
11. **Discharge and heat sink:**
    - Running: T_dis lags T2 with τ = 25 s. Off: it cools toward ambient with τ = 900 s.
    - T_fin → T_amb + finRth·(0.04·P_comp + P_inv,fixed) with τ = 90 s.
12. **Room:** see §10.
13. **Useful capacity at the room boundary:**
    ```
    Q_net = ṁa·(h_return − h_supply)   (sign by mode; includes fan heat)
    Q_sens = −ṁa·cp·(T_sup − T_room)
    Q_lat  = ṁa·(w_room − w_sup)·h_fg0
    SHR    reported only for |Q_net| > 150 W
    ```
14. **Power and current:**
    - P_total = P_comp + P_ifan + P_ofan + P_controls.
    - Current = P_total/(supplyV·PF), with PF set per mode.
    - COP is reported only for P > 80 W and Q > 150 W. EER is in Btu/(W·h).
15. **Integrals:** energy (total, compressor, each fan), Q_net, Q_gross, condensate, frost melted, defrost energy, run time.
16. **Leaving outdoor air:**
    ```
    T_leave = coil outlet + (P_ofan + Q_shell + P_loss − Q_pickup)/(ṁa,out·cp)
    ```
    This closes the whole-system balance.
17. **Flags** (text shown in the UI):
    - property table left
    - outdoor above 46 °C in cooling or below −15 °C in heating
    - frequency above the published curve
    - fan rpm outside the table
    - room air saturated
18. **`checkPlant`:** reject non-finite values, coil temperatures outside −40…75 °C, or w < 0.

**Chamber mode:** when `env.chamber` is set, pin the room air and mass to the chamber state after each step. Use it for the rating-point tests.

---

## 10. Room model

**State:** air temperature T_room, humidity ratio w_room, and lumped thermal mass T_mass.

```
V      = roomW·roomH·roomD;   M_da = V/specVol
C_air  = M_da·cpMoist
ṁ_inf  = (ach + 6·doorOpen)·V/3600·ρ_da
C_air·dT_room/dt = Q_sup,sens + uaAirOut(T_out−T_room) + ṁ_inf·cp(T_out−T_room)
                 + hAmass(T_mass−T_room) + solar(1−solarToMass) + internal + occupants·occSens
C_mass·dT_mass/dt = hAmass(T_room−T_mass) + uaMassOut(T_out−T_mass) + solar·solarToMass
M_da·dw/dt = ṁa(w_sup − w_room) + ṁ_inf(w_out − w_room) + occupants·occLat/h_fg0
```

- If w exceeds saturation, clamp it and flag that moisture condensed on surfaces.
- **Default environment:** outdoor 35 °C / 40 %, solar 250 W, internal 150 W, 1 occupant, ACH 0.5, door closed.
- **Default initial state:** room 30 °C / 55 %, Monday 14:00 (t0 = 50 400 s).

---

## 11. Air distribution model (`model/airfield.ts`): approximate, not CFD

### 11.1 Frame, room and obstacles

**Room frame:** x across the wall (0…W), y up (0…H), z into the room from the wall that carries the indoor unit (0…D). The outdoor unit is at z < 0.

**Room size:** 4 × 2.8 × 4 m.

**Obstacles** (min → max, in m):

| Obstacle | min | max |
|---|---|---|
| desk | [0.25, 0, 2.2] | [1.45, 0.75, 2.9] |
| bed | [2.3, 0, 1.5] | [3.9, 0.5, 3.2] |
| wardrobe | [3.35, 0, 3.35] | [3.95, 2.0, 3.95] |

**Outlet pose:**

- Outlet: [mountX, mountH − H_unit + 0.04, 0.62·D_unit].
- Return: [mountX, mountH + 0.02, 0.45·D_unit].

### 11.2 Jet trace (`traceJet`)

**Initial values:**

- u0 = q/A0, ΔT0 = T_sup − T_room.
- Direction: d = (cosθ·sinφ, −sinθ, cosθ·cosφ), where θ = 0.65·upper + 0.35·lower (degrees below horizontal) and φ = wide-vane angle.

**Per step (ds = 0.05 m, up to 400 steps):**

- **Potential core** s0 = jetK·√A0: u = u0 for s < s0, then u = u0·s0/s (× wall decay).
- **Temperature excess:** ΔT = ΔT0·min(1, s < s0 ? 1 : 0.8·s0/s + 0.2·e^(−(s−s0)/1.5)).
- **Width:** b = 0.5·√A0 + jetSpread·s.
- **Throw:** the first s where u < terminalV.
- **Buoyancy:** κ = g·β·ΔT/max(0.05, u²)·0.35 with β = 1/T_room,K. Add κ·ds to d_y and renormalise.
- **Walls, ceiling and floor:** clamp the position, zero the normal component of d (the jet becomes a wall jet), multiply the wall decay by 0.985, and record the attached surface.
- **Obstacle:** lift the point to the obstacle top, force d_y ≥ 0, multiply the decay by 0.9, and record the obstacle.
- **Stop** when u < 0.05 or s > 14 m.

### 11.3 Zonal field (`computeField`)

- **Grid:** 20 × 14 × 20 cells holding T, |v|, vx, vy and vz.
- **Jet contribution:** for jet samples (stride so that about 48 are used), only within 2.2·b of each sample:
  - |v| = u·e^(−r²/b²), keeping the maximum.
  - ΔT = ΔT·e^(−r²/(1.44·b²)), keeping the value of largest magnitude.
- **Background recirculation toward the return grille:**
  ```
  u_b     = max(0.03, 0.6·q/(W·H))
  capture = min(1, 0.35/r_n)
  v_bg    = u_b·(0.5 + capture)/r_n · (return − x)
  ```
- **Stratification:**
  ```
  mix   = Σu(y<1.8)/Σu
  strat = P.strat·|ΔT0|·(1 − 0.7·mix)
  T     = T_room + ΔT_jet + sign·strat·(y − H/2)·0.6
  ```
  A cold supply gives warm air at the top.
- **Energy consistency:** shift every cell so the volume mean equals T_room. Louvers then redistribute air but cannot create energy.
- **Time averaging:**
  - Recompute every `fieldInterval`: 2 s live, 10 s in batch runs.
  - Keep an exponential moving average (EMA) over 20 s to capture swing: a = min(1, Δt/20).
  - Re-centre the average on T_room.
  - Clamp the first Δt to `fieldInterval`.

  **Bug to avoid:** if the first update's elapsed time is measured from −10⁹ s, the time-weighted zone averages freeze at the initial temperature.

### 11.4 Comfort zones and metrics

| Zone | min | max | draft speed | band |
|---|---|---|---|---|
| Desk | [0.25, 0.6, 2.2] | [1.45, 1.3, 3.3] | 0.25 m/s | ±1.0 K |
| Bed | [2.3, 0.4, 1.5] | [3.9, 0.9, 3.2] | 0.20 m/s | ±1.0 K |
| Even room coverage | [0.3, 0.1, 0.5] | [3.7, 1.8, 3.7] | 0.25 m/s | ±1.5 K |

- **Zone statistics:** mean, min, max, standard deviation, draft fraction (cells above the draft speed), mean speed and cell count.
- **Time to target:** the zone mean (or the room temperature if no field) must stay inside ±band of the setpoint for a **300 s dwell**. Time to target is the moment it entered; energy to service is the energy used up to then.
- **Overshoot:** tracked after the target is reached.
- **Time-weighted averages:** zone mean, standard deviation and draft fraction.

---

## 12. Controller (`control/controller.ts`): surrogate of the documented behaviour

**Priority:** fault shutdown > protection/derating > mode sequence > user request > optimisation.

Manual overrides enter at the "user request" level and are **still clipped** by the envelope and the protections.

**Sensors:** first-order lags with τ = 20 s room, 8 s coils, 30 s ambient. Add biases for the room and coil sensor faults. Map sensor failures to RT11 (room), RT12 (indoor coil), RT62 (discharge), RT68 (outdoor coil) and RT65 (ambient).

**Each step, in this order:**

1. **Timers** (S2 9-7, 9-8):
   - ON and OFF timers.
   - Weekly timer: at most 4 per day and 28 per week; each entry is day, minute, on/off and temperature.
2. **Fault latch:**
   - **SIM-S01:** a sensor is open or shorted.
   - **SIM-C01:** communication lost for 180 s.
   - **SIM-F01:** the indoor fan is commanded above 100 rpm but turns below 20 rpm for `ifanFaultTime` (12 s, assumed).
   - **SIM-F02:** the same check on the outdoor fan for 30 s.
   - **SIM-N01:** more than 20 numerical step rejections.
   - **Reset rule:** the cause must be removed **and** power set to OFF then ON. The fault clears on the next ON.
3. **Mode:**
   - **Power ON edge:** vanes run a 3 s positioning, and the DRY setpoint is set to clamp(room − dryOffset, 16, 31).
   - **AUTO:** choose cool or heat by room vs setpoint. Change over after 900 s beyond the 1 K band (S2 9-5).
   - **Mode change:** reset the integrator.
4. **Effective setpoint:**
   - ECONO COOL adds +2 K in cool mode.
   - The sleep experiment adds a drift of rate × hours, capped at sleepMax, with the sign reversed in heat.
   - DRY uses its own setpoint.
   - Error e is room − set when cooling and set − room when heating. Positive means demand.
5. **Protections that stop the compressor:**

   | Protection | Stop | Release |
   |---|---|---|
   | Discharge temperature | > 116 °C (S3 no.10) | ≤ 100 °C and restart delay elapsed |
   | Coil frost stop (cooling) | coil < 1 °C (assumed) with the frost limiter at the minimum | coil > 10 °C |
   | High pressure | heating: indoor coil > 70 °C; cooling: outdoor coil > 70 °C (S3 no.12) | 15 K lower and delay elapsed |
   | Heat sink | fin > 80 °C | 10 K lower |
   | Low discharge | ≤ 50 °C for 20 min (S3 no.21) | logged |

6. **Thermostat:**
   - Thermo-OFF when e < thermoOff (−1 K) **and** the compressor is at minimum **and** it has been on for at least minOnTime (300 s).
   - Thermo-ON when e > thermoOn (+0.5 K).
7. **Defrost (heating):**
   - **Start:** after ≥ 1800 s of heating run time, with the outdoor coil ≤ −4 °C for 60 s.
   - **Phases:**
     - **stop** (30 s): compressor and fans stop.
     - **reverse:** cooling-direction cycle at 70 Hz, LEV 0.6, both fans off. It ends when the outdoor coil reaches ≥ 5 °C after 30 s, or at 600 s maximum.
     - **recover** (30 s): then back to heating.
   - **Restart delay:** **not** applied after defrost, because it is not a system stop. Set lastStop = t − restartDelay.
8. **Frequency request:**
   - **Maximum:** fMax = 98 Hz cooling, 115 Hz heating. DRY caps it at 40 Hz and NIGHT at 60 Hz.
   - **PI:**
     ```
     p     = kp·e                      (kp 12 Hz/K, ki 0.025 Hz/(K·s))
     unsat = p + I
     sat   = (unsat > fMax) or (unsat < fMin)
     integrate only if !sat, or if the error drives back out of saturation
     I clamped to ±fMax
     ```
   - Turbo adds +25 Hz for 15 min.
   - When the compressor is not wanted, the integrator decays with τ = 120 s.
9. **Limiters (derating caps):** each cap falls at 2 Hz/s from fAct + 2 while its condition holds, and recovers at 0.25 Hz/s. The tightest active cap wins and its name is shown as `limitReason`.

   | Limiter | Condition |
   |---|---|
   | Discharge | > 111 °C |
   | Indoor coil frost | ≤ 8 °C (cooling) |
   | Heating high pressure | indoor coil > 55 °C |
   | Cooling high pressure | outdoor coil > 62 °C (assumed) |
   | Current | > 10 A |
   | Eco cap (experiment) | total input above the cap |
   | Heat sink | > fin stop − 6 °C |

10. **Start/stop sequence:**
    - If the restart lockout is active (180 s since the last stop), the state is START_DELAY with a countdown.
    - Otherwise: STARTING. The outdoor fan and the 4-way-valve pulse (5 s) come first, then the compressor starts at fStart = 30 Hz and holds for 45 s, then modulates.
    - **Command ramp:** +1 Hz/s up, −2 Hz/s down.
    - **On stop:** record lastStop; the outdoor fan runs on for 15 s.
11. **Supervisor state:**
    - FAULT, STOPPING or OFF, DEFROST, PROTECTION, FAN_ONLY, STANDBY (thermo-off), then COOLING, HEATING or DRY.
    - MODULATING when near the setpoint, with hysteresis: enter at |e| < 0.7 and f < 0.5·fMax; stay while |e| < 1.3 and f < 0.7·fMax.
12. **Indoor fan:**
    - Uses the published rpm per step. In heating, use the heating column.
    - **AUTO:** e > 3 → Super High; e > 1.5 → High; e > 0.5 → Med; otherwise Low. In FAN mode, AUTO means Low. In DRY with AUTO, use cooling Low.
    - **Cooling/DRY thermo-off:** "very Low" 400 rpm.
    - **Heating cold-air prevention:** coil < 26 °C → 0; coil < 32 °C → very Low. The fan is off during defrost and during the 3 s positioning.
13. **Outdoor fan:**
    - **Cooling:** f < 30 → 470 rpm; f < 50 → 700; otherwise 940. The coil > 52 °C → 940. Ambient < 20 °C → ≤ 470; ambient < 10 °C → ≤ 300.
    - **Heating:** f < 35 → 640; f < 60 → 780; otherwise 900.
    - **NIGHT:** cap at 700. Off during defrost and on faults.
14. **LEV (surrogate of S3 10-3):**
    - The target is the computed discharge temperature T2 at the target superheat (5 K), recomputed every second.
    - Feed-forward: 0.12 + 0.33·f/84.
    - PI on (T_dis − target): kp 0.4 %/K, ki 0.006 %/(K·s), integrator ±0.6. Hotter than target means open further.
    - Command clamp 0.05–1; 0.6 during defrost; 0.25 at standby.
15. **Vanes:**
    - Position angles: pos 1 = 12°, pos 5 = 68°, linear in between (assumed angles; the positions are sourced).
    - AUTO: heating uses pos 4; cooling uses 6° ("horizontal").
    - **Dew prevention:** in cooling or DRY, pos 5 becomes pos 4 after 1 h of compressor time.
    - **Swing:** a cosine profile between the pos 1 and pos 5 angles over swingPeriod (14 s). Only the upper flap swings in cooling, DRY and FAN.
    - **ECONO:** swing with a modulated period.
    - **Heating cold-air:** flap goes upward.
    - **Wide vane:** pos 1–5 maps to −40…+40°. Swing is a sine over 16 s.
16. **4-way valve:** heating = 1. Defrost reverse = 0. Energised for 5 s right before start-up.
17. **Narration:** one plain-language sentence per state or limit (English and Arabic keys).

**Outputs to the plant:** f, ifan, ofan, eev, vaneUpper, vaneLower, wide, vaneOpen, rv.

---

## 13. Simulation engine (`sim/engine.ts`)

**State (`SimState`)** is plain JSON, so it can be snapshotted, posted between workers and replayed:

- version, t, seed, rng
- plant, ctrl, remote, overrides, env, faults
- profile, profileName
- probes, metrics, solverFaults, zone

**Step order:**

1. `controlStep`
2. `plantStep`. Cycle state points are computed every `detailEvery` = 5 steps.
3. `checkPlant`. If the step is rejected, keep the last good state (saved every 50 steps), log it, and after 20 rejections latch SIM-N01.
4. Advance time.
5. Update metrics.
6. Update the field every `fieldInterval`.
7. Record history every `historyInterval` (2 s).
8. Take a snapshot every 60 s. Keep at most 400 snapshots; always keep the initial one.
9. Update probes.

**History channels and units:** t s, Troom °C, RHroom %, Tset, Tsup, Tmass, Tout, fReq, fCmd, fAct Hz, ifan, ofan rpm, eev %, vaneU, wide °, Qnet, Qsens, Qlat, Qgross, Pcomp, Pfans, Ptotal W, COP, condRate L/h, Pe, Pc bar(a), Te, Tc, Tdis °C, SH K, frost kg, sup code, zoneMean °C, zoneStd K, current A, Tcoil °C. The cap is 12 000 samples.

**Actions:**

- `apply(action)` validates (§14), applies, logs `{t, action}` to `inputs`, and emits an event.
- If an action is rejected, emit a "Rejected: reason" event.
- **Side effects:**
  - Choosing a mode other than cool turns ECONO off.
  - The setpoint is re-clamped to the new mode's range.
  - Turbo sets `turboUntil` = t + 900.
  - Sleep sets `sleepSince`.
  - A profile patch renames the reference to "experiment (unsaved)".

**Replay and runs:**

- `replayTo(t)`: load the nearest earlier snapshot and re-simulate the logged inputs. This builds an independent simulation and must reproduce the state exactly.
- `exportRun()` returns `{kind 'ap35-run', version, dt, seed, initial snapshot, inputs, endT}`. `fromRun()` replays it and warns if the version differs.
- Branching replaces the live simulation with the replayed one.

**Probes:**

- **Air probes** (airT, airV, airRH) sample the averaged field. They are rejected outside the room or inside a solid obstacle, with a message saying why.
- **Refrigerant probes** snap to state points 1e, 1, 2, 3 and 4.
- **Electric probe:** P_total.
- **Virtual sensor model:**
  - Lag: sensorTau.
  - Sampling: sensorPeriod.
  - Gaussian noise from the seeded mulberry32 RNG: sensorNoise in K; 0.02 m/s for speed; 5 W for power.
  - Both the ideal and the virtual value are shown.

**RNG:** mulberry32. Its state is stored in the snapshot.

---

## 14. Action schema (`sim/schema.ts`)

`Action` is one of these types:

- `remote` (patch of RemoteSettings)
- `override` (experiment layer)
- `env`
- `faults`
- `isaveStore`
- `profile`

Every action is validated, so no path can bypass the limits.

**Validation rules:**

- **Setpoint:** COOL, DRY and AUTO allow 16–31 °C; HEAT allows 10–31 °C.
- **Enumerations:**
  - mode ∈ {cool, heat, dry, fan, auto}
  - fan ∈ {auto, Silent, Low, Med, High, SuperHigh}
  - vane ∈ {auto, 1–5, swing}
  - wide ∈ {1–5, swing}
- **Weekly timer:** at most 28 entries, at most 4 per day; day 0–6, minute 0–1439, temperature 10–31.
- **Operation lock:** a mode change is rejected while the lock is on.
- **Numbers:**
  - Every numeric field is range-checked.
  - Unknown fields are rejected.
  - Profile patches are checked against the parameter range and `locked` status.
  - Errors are readable, for example "setpoint (heat): 35 outside 10..31".

**RemoteSettings:** power, mode, setpoint, fan, vane, wide, econoCool, nightMode, isave, isaveMem {cool, heat}, onTimer, offTimer, weeklyOn, weekly[], opLock.

**Overrides:** manual, compHz, ifanRpm, ofanRpm, eevPct, vaneAngle, wideAngle, swingLo, swingHi, ecoCapW, turbo, turboUntil, sleep, sleepRate, sleepMax, sleepSince.

**Faults:**

- filterRestriction 0–6
- coilFouling 0–1, outdoorFouling 0–1
- indoorFanFault, outdoorFanFault
- roomSensorBias, coilSensorBias
- sensorFail ∈ {none, room, indoorCoil, discharge, outdoorCoil, ambient}
- commFault

---

## 15. Scenarios (`sim/scenarios.ts`)

Each scenario has an initial state, a timed schedule of actions, a duration, and optional variants for A/B.

| Id | Initial | Schedule | Duration |
|---|---|---|---|
| pulldown | room 30 °C / 55 %, outdoor 35 °C / 40 % | COOL 24, fan AUTO, vane AUTO | 3600 s |
| lowload | room 24.6 / 50, outdoor 29 / 50, solar 0, internal 80 | COOL 24 | 5400 s |
| hot | room 33 / 40, outdoor 46 / 25, solar 700 | COOL 24, AUTO | 3600 s |
| fanAB | as pulldown | COOL 24; variants Low / High | 3600 s |
| louverAB | as pulldown | COOL 24, fan Med; variants vane 1 / vane 5 / swing | 3600 s |
| filter | room 29 / 55 | COOL 20, fan Low; at 300 s filterRestriction = 4 | 2700 s |
| loadstep | room 24.5 / 50 | COOL 24; at 1200 s internal = 1350 W and door open | 3600 s |
| dry | room 27 / 80, outdoor 30 / 75, solar 100 | DRY, fan AUTO | 3600 s |
| heatup | room 14 / 55, outdoor 7 / 87, solar 0, internal 100 | HEAT 22 | 3600 s |
| defrost | room 16 / 50, outdoor 0 / 92, solar 0, internal 0, ACH 2 | HEAT 24 | 6300 s |
| fanfault | room 28 / 55 | COOL 24; indoor fan seized 600 s; cause removed 1200 s; OFF 1210; ON 1220 | 2400 s |
| sensorfault | room 28 / 55 | COOL 24; room sensor open 480 s; restored 900; OFF 905; ON 915 | 1800 s |

Each scenario has a title in English and in Arabic.

---

## 16. Batch tools

### 16.1 Runner (`runner.ts`)

**`runSchedule(init, schedule, duration, label)`:**

- dt 0.1 s, field every 10 s, history every 10 s, no cycle detail.
- Applies scheduled actions when their time is due.
- Supports progress callbacks and cancellation every 3000 steps.

**`RunSummary`:**

- reachedTarget, timeToTarget_s
- energy_kWh, energyToService_kWh
- avgUsefulCapacity_W, peakInput_W
- condensate_L
- occupiedMean_C, occupiedStd_K, draftFraction (time-weighted)
- inBandFraction, overshoot_K
- compressorStarts, faults, protections
- finalRoom_C, finalRH_pct
- serviceNote

**Comparisons:**

- **A/B (`runAB`):** every variant starts from the identical initial state and schedule.
- **Counterfactual:** from a recorded snapshot, run (a) the unchanged continuation and (b) the same continuation with one intervention, with identical later inputs.

### 16.2 Design of experiments (`doe.ts`)

**Sweep variables** (each with a "support" label):

| Id | Range | Applied as | Support |
|---|---|---|---|
| ifan | step 0–4 (integer) | remote fan | empirical-model |
| vane | 5–70° | override | empirical-model |
| setpoint | 22–27 °C | remote | empirical-model |
| outletH | 0.045–0.09 m | profile | empirical-model |
| mountH | 2.1–2.7 m | profile | empirical-model |
| kp | 4–30 | profile | empirical-model |
| ecoCap | 400–1300 W | override | empirical-model |
| vaneCount | 8–20 | profile | **visual-only**: never ranked feasible |

**Method:**

- **Latin hypercube:** deterministic, seeded with mulberry32. The baseline is always included.
- **Cache:** results are keyed by an FNV-1a hash of model + parameters + scenario + solver settings.
- **Feasibility:** target reached, draft ≤ maximum, visual-only geometry excluded. An infeasible design is never ranked feasible, and the reasons are listed.
- **Pareto:** among feasible designs, minimise energy-to-service and time-to-target. Present the result as "best among evaluated candidates under this model".
- **Global sensitivity:** standardised regression coefficients (normal equations with a ridge of 10⁻⁶) for energy, time and uniformity.
- **Robustness envelope:** nominal plus two corners varying envelope UA ±30 %, indoor UA ∓15 % and internal gains ±50 %.

### 16.3 Lab evidence (`evidence.ts`)

**CSV template:** columns are written as `name [unit]`. Lines starting with `#` are comments, and `# metadata: k=v, …` lines carry metadata.

**Columns:**

- **Required:** time [s], indoor_db [degC], outdoor_db [degC].
- **Optional:** indoor_rh or indoor_wb, outdoor_rh or outdoor_wb, supply_db, supply_rh, comp_hz, ifan_rpm, ofan_rpm, airflow [m3/h], power_total [W], capacity [W], steady [0/1].

**Units accepted:**

- degC, C, degF, K
- W, kW
- m3/h, l/s, cfm
- s, min

**Parsing rules:**

- Unknown columns are listed and ignored.
- Missing cells stay missing. Nothing is interpolated.
- Non-increasing time is an error.
- Gaps longer than 3 × the previous step produce warnings.

**Calibration:**

- **Identifiable scales only:** uaInAir 0.6–1.5, etaIsPeak 0.8–1.15, Vd 0.8–1.2.
- **Method:** a deterministic bounded coordinate search with ridge 0.05·Σ(s−1)².
- **Objective:** (capacity error / 1000 W)² + (power error / 300 W)² over the calibration rows.
- **Hold-out:** the last fraction of rows is used for validation. Report bias, MAE and RMSE separately for calibration and validation, plus the domain the data covers.
- **Result:** a new experiment profile. The reference is never modified.
- **Synthetic sample:** generated by the model with uaInAir × 0.88, etaIsPeak × 0.96 and seeded noise. It is labelled **SYNTHETIC** and is not a measurement.

### 16.4 Diagnostics (`diagnostics.ts`)

**Hidden training faults:**

- filter (restriction 3)
- inFoul (coil fouling 0.7)
- outFoul (outdoor fouling 0.8)
- roomBias (−2 K)
- coilBias (−4 K)

**Observations vs a clean-unit steady expectation at the same conditions** (each with a z-scale):

| Observation | z-scale |
|---|---|
| airflow | 25 m³/h |
| coil temperature | 0.8 K |
| Tc | 0.8 K |
| discharge | 2.5 K |
| fan power | 0.8 W |
| coil sensor − coil surface | 0.6 K |
| room sensor − independent probe (if a probe is placed) | 0.5 K |

**Scoring:**

- **Signatures:** each fault has an expected sign (−1, 0, +1, or not informative) for each feature.
- **Score:** a match scores +1; a mismatch scores −1. "Nothing expected, nothing seen" is skipped.
- **Untestable faults:** roomBias without an independent probe is capped and labelled untestable.
- **Ambiguity:** reported when the top two scores are within 0.5.
- **Output:** the next measurement to take.
- **Wording:** a training aid, not repair instructions.

### 16.5 "Why" inspector (`explain.ts`)

A dependency graph for fAct, Qnet, Troom, airflow, Te, Tc and Ptotal. Each entry has its equation, its parent quantities and the related parts.

The explanation lists:

- the active fault or limit
- the manual override
- the PI demand
- the filter effect
- NIGHT mode
- recent inputs and events (window 900 s)

**Counterfactual check:** "Test this explanation" runs a matched counterfactual for a single input.

### 16.6 Command assistant (`assistant.ts`): a regex intent parser, not a language model

Example phrases it accepts:

- "compare X and Y fan" / "compare X and Y vane"
- "why did compressor speed fall"
- "show heat flow"
- "best louver/fan for desk"
- "set temperature to N" / "set outdoor to N"
- "fan high" / "start cooling" / "stop"
- "place probe at desk"
- "select compressor"
- "export report"
- "load scenario defrost"

Every produced action passes the same validation. An unknown request returns a message listing example phrases.

### 16.7 Exports (`export.ts`)

| Export | Content |
|---|---|
| Settings JSON | schema `ap35-bench-settings`, version, only the profile overrides, remote, overrides, env, faults, zone. The schema and version are checked on import. |
| History CSV | `name [unit]` headers; time from start; header comment "Modelled values, not measurements" |
| HTML report | self-contained: disclaimer, starting state, changed variables, result table, probes, images, notes, sources, discrepancies, limitations, list of assumed parameters |
| PNG | screenshots and orthographic drawings |

---

## 17. Calibration and validation

### 17.1 Calibration script (`scripts/calibrate.ts`)

1. **Indoor fan power, from 19 W and 26 W at 970 and 1070 rpm (D4):**
   ```
   ifanEta  = (P_air(1070) − P_air(970)) / (26 − 19)
   ifanPbase = 19 − P_air(970)/ifanEta
   ```
2. **Fitted parameters** (sigmoid-bounded, so the optimiser runs unconstrained):

   | Parameter | Bounds | Prior |
   |---|---|---|
   | Vd | 4–12 × 10⁻⁶ m³ | 7.5 × 10⁻⁶ |
   | etaIsPeak | 0.5–0.85 | 0.7 |
   | etaIsPr | 0–0.25 | 0.05 |
   | prOpt | 1.8–4.5 | 2.8 |
   | fOpt | 35–90 Hz | 60 |
   | etaIsHi | 0–4 | 0.8 |
   | etaIsLo | 0–1.5 | 0.3 |
   | etaVlow | 0–0.15 | 0.04 |
   | etaVpr | 0–0.12 | 0.03 |
   | pInvFixed | 0–70 W | 15 |
   | uaInAir | 100–1200 W/K | 400 |
   | uaInRef | 200–4000 W/K | 1000 |
   | uaOutAir | 150–1500 W/K | 500 |
   | uaOutRef | 300–6000 W/K | 1500 |

3. **Objective:**
   - **Calibration rows:** wet rows with indoor DB ∈ {24, 27, 30} and outdoor DB ∈ {21, 35, 46}, outdoor RH taken as 40 %, run at rated frequency with fans 970/940 rpm. Error per row: (ΔQ/Q)² + 0.3·(ΔSHC/Q)² + (ΔP/P)², averaged.
   - **Cooling frequency curves:** points at 20, 30 … 90 Hz, weight 0.8; capacity and input factor errors relative to the rated point.
   - **Rated points:** weight 3 each for cooling 3.5/0.99 and heating 4.0/1.03 kW.
   - **Heating frequency curve:** calibration at 30/50/70/90 Hz, weight 0.8.
   - **Weak priors:** 0.002·Σ((p − prior)/(hi − lo))².
4. **Optimiser:** Nelder–Mead with two restarts (step 0.6, then 0.25) and a budget of `CAL_EVALS` (use 10 000).
5. **LEV Cv:** chosen so the rated cooling point needs 45 % opening.
6. **Outputs:** `src/config/calibration.json` (values + method + date) and `docs/calibration_report.json`.

**Reference result** (the values this build should reproduce):

| Parameter | Value |
|---|---|
| Vd | 9.63077e-6 |
| etaIsPeak | 0.849987 |
| etaIsPr | 0.0863 |
| prOpt | 3.25 |
| fOpt | 60.51 |
| etaIsHi | 0.277 |
| etaIsLo | 0.457 |
| etaVlow | 0.118 |
| etaVpr | 0.1165 |
| pInvFixed | 22.95 |
| uaInAir | 696.75 |
| uaInRef | 597.78 |
| uaOutAir | 639.17 |
| uaOutRef | 2242.47 |
| ifanEta | 0.487 |
| ifanPbase | 3.408 |
| eevCv | 5.547e-7 |

`etaIsPeak` ends at its upper bound. The effective displacement (9.6 cm³/rev) absorbs other errors (D3), so do not present it as a measured swept volume.

### 17.2 Validation (`model/validation.ts` + `scripts/validate.ts`)

The same function serves the tests, the CLI and the in-app Validation tab:

- rated points
- table statistics for calibration rows, held-out rows and dry rows: bias, RMSE, max for capacity and input, and sensible RMSE
- frequency curves, with the heating points at 20/40/60/80/100/110 Hz held out

The CLI writes `docs/validation_report.json`.

---

## 18. Workers and data flow

- **Live worker:** owns the authoritative `Simulation`.
  - Ticks every 16 ms; acc += realDt·speed; runs floor(acc/dt) steps, at most 4000 per tick, with real dt bounded to 0.25 s.
  - Speeds 1×, 5×, 30×, 60×. 60× means 600 steps per wall-clock second; the step is never enlarged.
  - Posts a `frame` at most every 33 ms with:
    - the view (state, outputs, setpoint, lockout left)
    - incremental history
    - new events
    - the averaged field as transferable Float32Arrays, only when changed
    - the jet (every 2nd point)
  - **Messages:** init, loadState, action (returns the validation result), run, speed, step, addProbe, removeProbe, setZone, explain, getRun, getCounterfactualInputs, replayTo, replayClose, branch, diagnose, visibility (pause when the tab is hidden).
- **Batch worker:** runs scenarioAB, customAB, counterfactual, sweep, robustness, evidence and validation, with progress and partial results.
  - **Cancel:** cooperative, by yielding (`setTimeout 0`) between runs. If the job has not returned within 2 s, the main thread terminates and respawns the batch worker and rejects pending jobs with "Cancelled…". A global `unhandledrejection` handler turns that into a toast.
- **The renderer never computes physics.** It reads the frame and only interpolates visuals.

---

## 19. 3D scene (`scene/*`)

### 19.1 Units and room

- **Indoor unit** (procedural, envelope 798 × 299 × 219 mm, local origin at the unit bottom, z out of the wall):
  - **Profile:** the side outline is extruded along x and smoothed with a spline. Points (z, y) in m: (0, 0.03) (0, 0.299) (0.168, 0.299) (0.196, 0.288) (0.214, 0.258) (0.219, 0.2) (0.217, 0.12) (0.209, 0.08) (0.196, 0.058) (0.17, 0.045) (0.07, 0.016) (0.03, 0.007) (0.006, 0.014).
  - **Internals:** cross-flow fan (z 0.10, y 0.14, r 0.046, x −0.30…0.295), fin-pack coil (instanced), two horizontal vanes, vertical vanes, drain tray with a water level from the film, indicator lamp, filters, electrical box, Wi-Fi interface.
  - **Piping:** connections at the rear right.
- **Outdoor unit** (800 × 550 × 285 mm; fan centre x 0.3025 m, y 0.28 m, r 0.19 m; partition at x 0.56 m):
  - L-shaped coil (rear + left), propeller fan, grille.
  - Compressor with accumulator and a visible rotor.
  - 4-way valve with a slider showing its position.
  - LEV, strainer, capillary, mufflers, stop valves, inverter board with heat sink, reactor.
  - Thermistors RT61, RT62, RT65 and RT68.
  - Frost layer whose opacity follows the computed frost.
- **Room diorama:**
  - **Room and furniture:** 4 × 2.8 × 4 m, wall thickness 0.22 m. Indoor unit at mountX = 2.0 m, top at mountH = 2.55 m. Furniture comes from the obstacle boxes (desk with monitor, bed, wardrobe). A seated figure sits at the desk.
  - **Exterior wall:** drawn as a **section cut** at x = mountX + 0.72, with a hatched cut face. The outdoor unit sits beyond the cut on a wall bracket: position (mountX + 1.75, 0.95, −wallT − 0.12), rotated 180°.
  - **Surroundings:** an outdoor ground slab and a light floor grid.
- **Lighting:** hemisphere light (0xfffaf0 / 0xcfc6b5, 0.55) plus a directional sun (0xfff4e0, 1.6) with a 2048² shadow map. RoomEnvironment is used for reflections.
- **Materials:** see the palette in §20.6. Casing is off-white clearcoat 0xf4f2ed; copper 0xb87333; aluminium fins 0xc8ccd2; compressor 0x23262b; graphite 0x2d2c2a.

### 19.2 Part registry

Every part is registered with: id, name (optional Arabic name), unit (indoor/outdoor/room/pipe), **fidelity** (sourced, modelled or conceptual), source page, function text, links to physics quantities, explode vector, and a casing flag.

The parts are:

- **Indoor:** chassis/nozzle, stabiliser, front panel, lamp, air inlet, coil, cross-flow fan, fan motor RC0J30-CV, bearing, drain tray, upper vane, lower vane, vertical vanes, vane motors MV1–3, electrical box, Wi-Fi, connections.
- **Outdoor:** base, cabinet, grille, top, right panel, service panel, coil, rear guard, RT65, RT68, RT61, propeller fan, motor RC0J50-NC, partition, compressor KVB073FYXMC, RT62, 4-way valve 21S4, two mufflers, LEV, strainer, capillary, stop valves, inverter board, reactor L61.
- **Room and pipes:** wall, cable, drain hose.

Clicking a part opens the inspector: function, source, fidelity, live values and the "why" link.

### 19.3 Visual behaviour (from computed values only)

- **Fans:** spin with the actual rpm, with a visual speed cap to avoid stroboscopic aliasing (indoor 2.2 rad/s, outdoor 4.5 rad/s) plus a motion-blur disc. The compressor rotor spins too. "Mechanism slow view" slows the visuals only.
- **Vanes:** rotate to the actual angles; wide vanes yaw.
- **Lamp:** brightness follows power and NIGHT.
- **Indicators:** tray water level, frost opacity, 4-way slider.
- **Pipes:** coloured by computed refrigerant temperature (scale −5…95 °C). Cycle tracers move along the loop in the actual flow direction, which reverses in heating. Heat arrows show where heat enters and leaves.
- **Coil fins:** tinted by the computed surface temperature in Cutaway and Cycle views.
- **Particles:** 1600 indoor and 700 outdoor (point sprites with a radial-gradient texture).
  - Indoor particles follow the averaged field and the jet, only inside the room (z ≥ 0), avoiding obstacles and the unit body, plus an internal path through the unit.
  - Outdoor particles stay outside the wall (rear/left intake → coil → fan → front discharge).
  - Colour by temperature (blue → red scale: 10–34 °C, widened around the room temperature) or by speed (0–3 m/s).
- **Airflow visuals:** plume mesh around the jet, faint dashed jet centreline (opacity 0.35), streamlines seeded on a 5 × 4 grid, horizontal and vertical slice textures (colour range room ±4 K), arrow field.
- **Camera presets** (eased 1.2 s fly; ix = mountX, iy = unit centre height):

  | Mode | Camera position | Target |
  |---|---|---|
  | system | (ix−1.75, 2.95, 3.85) | (ix+0.8, 1.45, −0.25) |
  | indoor | (ix−0.75, iy−0.25, 0.95) | (ix, iy, 0.1) |
  | outdoor | (ix+0.55, 1.85, −2.0) | (ix+1.35, 1.2, −0.5) |
  | cutaway | (ix−1.6, 2.5, 2.2) | (ix+0.6, 1.65, −0.3) |
  | airflow | (−2.2, 2.6, 5.6) | (ix+0.1, 1.0, 1.6) |
  | cycle | (ix−0.7, 2.7, 2.4) | (ix+0.75, 1.55, −0.3) |
  | comfort | (−0.9, 5.6, 6.0) | (2.0, 0.4, 1.9) |
  | exploded | (ix−0.4, 2.3, 2.3) | (ix+0.75, 1.7, −0.3) |

  FOV is 38°. On portrait or narrow stages, keep the horizontal FOV of a 1.6 aspect, capped at 95° vertical.
- **8 view modes** (keys 1–8): System, Indoor, Outdoor, Cutaway/X-ray (casing ghosted to 0.14 plus a clipping plane), Airflow (plume + streamlines), Refrigeration cycle (tracers, heat arrows, ghosted casing), Room comfort (plume, arrows, horizontal slice), Exploded.
  - **Exploded:** parts move along their explode vectors, pipes are hidden, labels with leader lines are laid out in two columns, and the simulation **pauses** until "Reassemble and resume".
  - **Narrow screens:** labels become numbered tap targets.
- **Orthographic drawings:** indoor front, indoor side, section A-A through the blower and vanes, plan, outdoor front.
  - An allowlist hides the walls, and the background is grey.
  - **Only published envelope dimensions are dimensioned**; internal geometry is labelled as modelled.
  - PNG export.
- **Design handles:** drag handles on the outlet (Design Lab) edit outletH and mountH through the profile. A ghost line shows run B's jet in A/B.

---

## 20. User interface

### 20.1 Layout

A CSS grid `#shell` with these areas:

```
"hdr hdr hdr" / "left stage right" / "left bottom bottom"
```

- **Rows:** header 58 px / 1fr / bottom 236 px.
- **Columns:** side 296 px / 1fr / 296 px.
- **Below 980 px:** a single column (header, stage at 62 vh, right, left, bottom), with charts stacked, header chips wrapping and overlays repositioned.
- **No horizontal page scroll** at 390 px width.

### 20.2 Header

- **Brand:** "AP**35**" with "35" in red, "Mitsubishi Electric · Live Inverter Bench Study", and "MSZ-AP35VGK + MUZ-AP35VG · R32 · 3.5 kW (11,943 Btu/h)".
- **Workspace switch:** Explore / Engineer / Design Lab.
- **Clock:** pause/run (Space), single step +1 s, deterministic reset, speed select, simulated clock ("Mon 14:00:00").
- **Chips** (scrollable group):
  - profile chip: "Reference", or "name · N changed" in red for an experiment
  - "Modelled ⓘ", which shows ⚠ when flags are active
  - "⌘ Ask" (Ctrl+K)
  - "⤓ Export"
  - "EN · عربي"
  - "♪ off/on"
  - "?" (shortcuts)

### 20.3 Left column

- **Original product operation:**
  - A big **Start cooling / Stop** button. It shows the restart-delay countdown ("Waiting N s (3-min restart delay)").
  - A virtual remote: an LCD showing set temperature, mode, fan, vane, wide, NIGHT, timers and lock, plus these buttons:
    - STOP/OPERATE, MODE, TEMP ▼, TEMP ▲, FAN, VANE, WIDE VANE
    - ECONO COOL (cooling only), NIGHT MODE
    - i-save (not in DRY/AUTO), i-save SET
    - TIMER (dialog for ON/OFF and weekly), LOCK
  - Every button carries a tooltip citing its S2 section.
- **Scenario:** a select with the 12 scenarios and their descriptions, plus Load & run, Guided tour, Follow room air, Follow refrigerant and Follow control command.
- **Engineer only:**
  - **Engineering console** (banner: "Simulator experiments, not original remote functions"):
    - Reset to published baseline; Manual override checkbox.
    - Sliders: compressor 0–120 Hz, indoor fan 0–1300 rpm, outdoor fan 0–1100 rpm, LEV 0–100 %, vane −10…90°, wide −60…60°, swing limits.
    - Each slider shows **requested / applied / actual**, plus the limit reason.
  - **Experimental functions:** eco cap 150–2500 W, Turbo, Sleep (rate 0–3 K/h, limit 0–4 K).
  - **Conditions & room loads:** outdoor T −20…50, RH 5–100, solar 0–2000 W, internal 0–3000 W, occupants 0–8, ACH 0–6, door open, psychrometric chamber.
  - **Room & geometry (design):** mount height 1.9–2.75, mount x 0.5–3.5, outlet height 0.03–0.12, outlet width 0.3–0.75, vane count (visual-only), room width and depth 2.5–8 (thermal only), envelope UA, thermal mass, pipe length (geometry-only, no performance effect).
  - **Faults:** filter 0–6, indoor and outdoor fouling, fans seized, communication lost, sensor biases ±5 K, sensor open/short.
  - **Controller (advanced, surrogate):** Kp, Ki, thermo-off/on, superheat target, ramp-up, swing period.
  - **Virtual sensors:** lag, sample period, noise.
- **Design Lab only:** profile manager.
  - The reference is shown as immutable.
  - Create a named copy, undo, redo, use reference, edit outlet with 3D handles.
  - A list of experiments with delete.
  - "Changed parameters (N)" showing reference → value, a model/visual-only badge, and Revert.

### 20.4 Right column

- **KPI cards** (clickable to "why"):
  - Room temperature, with target and RH.
  - Useful capacity, with sensible, latent and SHR.
  - Electrical input, with COP and kWh.
- **Controller:**
  - The state pill (13 states, colour-coded) with a "surrogate" badge.
  - The narration sentence (English or Arabic, right-to-left).
  - The active limiters with their caps.
  - Flags.
- **Live measurements** (Engineer and Lab; bar(a)/bar(g) toggle). Sections for air, actuators, capacity & power, and refrigerant; every row is clickable to "why":
  - **Air:** return, supply, mass, outdoor in → leaving, airflow and Δp, resistance split.
  - **Actuators:** compressor request/command/actual, mechanical rpm / electrical Hz, fans command/actual, LEV, vanes, 4-way valve.
  - **Capacity & power:** net, gross, sensible/latent/SHR, power split, current, COP/EER, energy, condensate.
  - **Refrigerant:** HP/LP, Tc/Te, suction/discharge, superheat, subcooling (assumed), mass flows, coil surfaces, frost, core residual.

### 20.5 Bottom tabs (15)

| Tab | Workspaces | Content |
|---|---|---|
| Trends | all | 3 charts: temperatures (room, target, supply, zone, mass); compressor & fans (command, actual, PI request; fans on the right axis); capacity, power, COP |
| States & events | all | humidity & condensate; refrigerant states; timestamped event timeline |
| Refrigeration circuit | all | schematic with live state points and roles (cool/heat) |
| P-h cycle | all | log-P diagram, R32 dome, points 1–4 with temperatures and phases, gauge toggle |
| Room slices & comfort | all | plan and section slices, zone selector, zone stats |
| Assembly drawings | all | 5 orthographic views with published dimensions, PNG |
| Probes | Engineer, Lab | presets (T at desk, bed, return …), "try solid cell" (shows the rejection), ideal vs virtual plots |
| Timeline & replay | Engineer, Lab | scrub to time t, replay, branch, export/import run, replay check |
| Diagnostics | Engineer, Lab | hidden training fault, place independent probe, ranking, ambiguity, next measurement, reveal |
| A/B compare | Lab | presets (fan A/B, louver A/B/C) or custom, run from identical states, metric table (time to target, energy, energy to service, zone mean/std, draft, starts …), common-scale chart, ghost jet in 3D |
| Sweep & Pareto | Lab | variable table with ranges, runs, seed, zone, maximum draft, duration, run/cancel with progress, Pareto scatter, sensitivity table, candidate table with "Inspect in 3D" |
| Robustness | Lab | envelope across the corner cases |
| Lab evidence | Lab | template download, import CSV, synthetic sample, validation fraction, calibrate, residual plot, statistics, coverage |
| Validation | Engineer, Lab | runs the validation and shows rated points, table statistics, frequency curves, parity plots |
| Assumptions & sources | all | sources, discrepancies, parameter register with status filters, feature matrix (original vs experiment) |

**Charts:** a lightweight canvas line chart with labelled axes and units, a right axis, selectable traces, nice tick steps with correct decimals, "min" time axis and a replay cursor.

### 20.6 Design tokens

| Token | Value |
|---|---|
| --paper | #f4f1ea |
| --paper-2 | #ece7dd |
| --card | #fbfaf6 |
| --ink | #23221f |
| --ink-2 | #5b5850 |
| --ink-3 | #8a857a |
| --line | #d9d2c4 |
| --line-2 | #e7e1d5 |
| --red | #c4161c |
| --blue | #2f7fc1 |
| --amber | #d9861c |
| --copper | #b87333 |
| --ok | #2e7d4f |
| --warn | #b7791f |
| --radius | 8px |

**Fonts:**

- Sans: Inter / Segoe UI.
- Mono: JetBrains Mono / Cascadia Mono, with tabular numbers for all values.
- Arabic: Segoe UI / Noto Naskh Arabic.

**Badges per status:** sourced (green), assumed/modelled (amber), calibrated (blue), digitised (violet), computed (grey), conceptual (red).

**Overlays on the stage:**

- the view-mode pills
- the independence notice
- "Approximate airflow model, not CFD validation"
- the colour legend
- slice sliders and toggles (Streamlines, Plume, Arrows, Particles)
- Mechanism slow view, colour by temperature or velocity, PNG

### 20.7 Other UI features

- **Component inspector** and a compressor explainer (marked conceptual).
- **"Why" inspector** with a counterfactual test.
- **Guided tours** in four variants, in English and Arabic.
- **Command palette** (Ctrl+K).
- **Timers dialog.**
- **Sound:** Web Audio, synthesised and illustrative; it is not dB(A).
- **Record:** a 12 s WebM capture of the 3D view, via MediaRecorder; if unsupported, the app explains why.
- **Keyboard:** 1–8 select views, Space pauses or runs, Ctrl+K opens the palette, ? shows the shortcuts. Shortcuts are ignored while typing.
- **Toasts** for rejected actions and cancelled jobs.
- **Accessibility:** `:focus-visible` outlines, `aria-label` on icon buttons, `aria-live` on the LCD, reduced-motion preference.
- **Arabic:** narration keys, UI notices and tour text; set `dir="rtl"` on Arabic blocks.

---

## 21. Tests and acceptance criteria

Every check **runs the model**; nothing is compared against the constant used to display it. Print achieved values as `[result] …` lines, so the test log doubles as the validation record.

### 21.1 Physics (`tests/physics.test.ts`)

| Check | Limit | Reference result |
|---|---|---|
| R32 h error at the 5 CoolProp check points | < 0.4 % | ≤ 0.005 % |
| Tsat(psat(T)) round trip | < 0.02 K | ✓ |
| Quality only inside the dome | — | ✓ |
| Psychrometrics self-consistent (wet bulb, RH, dew point) | — | ✓ |
| Dynamic rated cooling, chamber 25 min, fan Super High, rated Hz, outdoor fan 940 | ±5 % on 3.50 / 0.99 kW | 3.508 / 0.998 kW |
| Dynamic rated heating, fan Super High, outdoor fan 900 | ±5 % on 4.00 / 1.03 kW | 3.990 / 1.027 kW |
| Held-out table rows (n > 200) | capacity RMSE < 5 %, input RMSE < 6 % | n 283: 2.14 % / 3.09 % (max 4.75 / 10.74 %) |
| Capacity at fMaxCool | within 6 % of 3.8 kW | 3.81 kW |
| Capacity at fMin | within 25 % of 1.1 kW | 0.90 kW (known gap) |
| Core cycle residual at steady state | < 2 % | 0 |
| Whole-system residual (outdoor air rise vs removal + all input) | < 5 % | −0.40 % |
| Dynamic steady state = steady solver (Te, Tc) | < 0.15 K | 0.00 K |
| Room energy residual over a transient incl. storage | < 1 % | 0.70 % |
| DRY 60 min: w ≥ 0, RH ≤ 100 %, condensed = bookkept | < 2 % | 0.416 = 0.416 kg |
| dt 0.1 vs 0.05 s: Troom, energy, Qnet | < 2 % | ≤ 0.003 % |

### 21.2 Control (`tests/control.test.ts`)

| Check | Reference result |
|---|---|
| Frequency ramp limits and envelope respected | up 1.0 / down 0.21 Hz/s |
| Restart lockout honoured | restart after 185.3 s |
| Anti-windup: integrator after 1 h saturation; falls promptly on reversal | 0; 30 Hz after 4 min |
| Low-load cycling: thermo-off and restarts respect the lockout | 5 / 5 |
| Vane direction alone gives the same capacity (fixed resistance) | 2797 W at 5° / 35° / 65° |
| Desk zone mean differs between horizontal and downward vane | 25.84 vs 25.97 °C |
| Fan Low vs High changes Te, Qnet and supply T | 5.74 / 7.74 °C; 2568 / 2767 W |
| Restricted filter lowers airflow | 354 → 276 m³/h |
| Fan-only mode: small, then negative Qnet (stored cold, then fan heat) | 73 W → −14 W |
| Heating: valve reversed, plausible Tc / Te / Tsup | ✓ |
| Defrost: frost accumulates, reversed cycle melts it, ends at the finish temperature | 2 cycles, 0.913 kg melted |
| Indoor and outdoor air separated (particles) | outdoor max z −0.24 (wall face −0.22) |
| Determinism: reset and replay reproduce state and ordered events | Troom difference 0 |
| Accelerated time = same steps; pause freezes | ✓ |
| Override 140 Hz is clipped, and the reason shown | 30.1 Hz, "High pressure, COOL (assumed)" |
| Indoor fan fault latches and resets only after cause removed + power cycle | SIM-F01 ✓ |
| Communication fault after 180 s | ✓ |
| LEV forced to 100 % floods the compressor | discharge 79 → 42 °C, suction quality 0.80 |
| Initial state sane | ✓ |

### 21.3 Experiments (`tests/experiments.test.ts`)

- Schema: rejects bad actions; settings import/export round-trips; history CSV has units.
- The reference profile is immutable; experiments branch; revert, undo and redo work.
- Geometry edit: outlet 50 vs 90 mm changes airflow (491 vs 548 m³/h) and jet velocity (4.54 vs 2.82 m/s).
- All 12 scenarios run with no solver rejections.
- Zone metrics after a 30 min pull-down follow the room: mean 24.52, std 0.48 K, final 23.70 °C.
- Fan A/B: time to target 323 vs 263 s.
- Sweep: LHS is deterministic, Pareto contains only feasible designs, the baseline is included, visual-only designs are infeasible.
- Diagnostics: a restricted filter ranks filter or inFoul first, and ambiguity is reported.
- Evidence on the synthetic sample: etaIsPeak scale 0.9625 (true 0.96); uaInAir is poorly identifiable; validation stays separate.
- Assistant: phrases parse to validated actions.

### 21.4 Browser smoke test (`e2e/smoke.mjs`, Playwright + Chromium)

**Checks (44, all must pass):**

- The page loads with a WebGL canvas.
- Start cooling works and the readouts update.
- The render loop runs.
- All 8 view modes switch.
- In every workspace, open every tab and click every visible button, except long jobs, which are driven explicitly.
- Left-panel buttons work.
- An experiment copy appears in the header.
- A/B produces its table.
- A sweep cancels in ≤ 3 s.
- The Arabic toggle renders Arabic text.
- Phone at 390 × 844 has no horizontal overflow.
- **No console errors or uncaught exceptions.**

Save screenshots to `e2e/shots/`. Use `--use-gl=angle --use-angle=swiftshader` on machines without a GPU.

---

## 22. Delivery

1. **Build:** `npm run build` runs `tsc --noEmit` plus `vite build` and produces `dist/` with index.html, assets/index-*.js and assets/worker-*.js, CSS and `.nojekyll`. **Commit `dist/`** so users without a toolchain can run the app.
2. **Static server (`serve.mjs`):** zero dependencies.
   - Serves `dist/` on 127.0.0.1 (default port 4173).
   - Correct MIME types (`.js` as text/javascript), `no-cache`, path-traversal guard.
   - `--open` launches the browser. A busy port gives a clear message.
   - Module workers need http://, so opening the file directly will not work.
3. **Windows launchers:**
   - `start-windows.bat` (CRLF line endings): check for Node; if `dist\index.html` is missing, run `npm install` and `npm run build` once; then run `node serve.mjs 4173 --open`.
   - `dev-windows.bat`: hot-reload development.
4. **Public link:** GitHub Pages.
   - Push the contents of `dist/` to a `gh-pages` branch at its root.
   - In the repository: Settings → Pages → Deploy from a branch → `gh-pages` / root.
   - Relative paths (`base: './'`) make it work under `/<repo>/`.
5. **Documentation shipped with the code:**
   - README (run steps for Windows and others, commands, workspaces, architecture)
   - MODEL_NOTES (equations, boundaries, validity, gaps)
   - CALIBRATION_GUIDE
   - Generated from the code with `npm run docs`, so they cannot drift: SOURCE_REGISTER, PARAMETERS, FEATURE_MATRIX
   - docs/TEST_RESULTS
   - IMPLEMENTATION_CHECKLIST

**Feature matrix** (original product vs experiment; show it in the app):

| Function | Status | Where in the app |
|---|---|---|
| STOP/OPERATE, MODE (AUTO/COOL/DRY/HEAT/FAN), setpoint ranges, 5 fan steps + AUTO, VANE 1–5/AUTO/SWING, WIDE VANE 1–5/SWING, ECONO COOL, NIGHT MODE, i-save (2 presets), ON/OFF and weekly timer, operation lock, 3-minute restart delay | original | remote |
| POWERFUL, LONG | not on AP35 | not offered |
| Eco power cap, sleep drift, turbo, manual Hz/rpm/LEV/vane, geometry edits | experiment only | labelled experiment layer |
| Wi-Fi / MELCloud | VGK has the interface | shown as a part only; no network control |

---

## 23. Known limitations to carry forward

Write these into the docs as they are; do not hide them.

1. **SHF at rating:** about 0.84 vs the published 0.88 (D6). Dry-row capacity RMSE is 5 %.
2. **Catalogue minimum cooling capacity:** 0.90 vs 1.1 kW (−18 %).
3. **No refrigerant charge or inventory model:** no charge faults.
4. **Conceptual internals:** compressor internals, PCB layout and blade counts in 3D are conceptual or modelled, and labelled as such.
5. **Assumed thresholds:** thresholds and gains that are not published are assumed, and can be edited only in experiments.
6. **Lab evidence:** steady-state calibration only. Transients are compared visually.
7. **Room geometry:** edited room dimensions affect the thermal model and the grid, but the 3D room stays 4 × 4 m.
8. **A/B in 3D:** no side-by-side 3D viewports; A/B uses 2D slices plus a ghost jet.
9. **Sound:** illustrative only.
10. **Batch cancel:** cooperative between runs; inside one long run it falls back to a hard stop (no partial result).
11. **Airflow model:** a zonal/jet approximation, not CFD.
12. **Calibrated displacement:** an effective parameter, not a measured value.

---

## 24. Build order

Validate each milestone before moving on.

1. **Properties:** R32 tables and psychrometrics, with property tests.
2. **Data:** source register and published data (Appendices B–D) in `published.ts`; parameter registry.
3. **Components:** component models and the steady solver.
4. **Calibration:** calibration script, then validation. Rated points must be within 1 % and held-out capacity RMSE about 2 %.
5. **Dynamics:** dynamic plant, room, then the controller. Run the energy, moisture, timestep and control tests.
6. **Engine:** engine, schema, scenarios, replay and determinism.
7. **Air distribution:** airflow field and zones, plus a zone-metric regression test.
8. **Batch tools:** runner, A/B, DOE, evidence, diagnostics, explain, assistant, exports.
9. **Workers:** live and batch workers with a cancellable batch path.
10. **3D:** units, part registry, room diorama, view modes, particles, drawings.
11. **UI:** workspaces, panels, tabs, i18n, persistence.
12. **Smoke test:** run it on desktop and phone with zero console errors.
13. **Delivery:** build, server, Windows launchers, GitHub Pages, generated docs, test results.

---

# Appendix A: Parameter register (reference profile)

Every parameter of the reference profile `mitsubishi_ap35_reference`. **Edit** column: `locked` = published value, cannot be changed in experiments; `model` = experiment can change it and the model responds; `geometry` = visual-only.

## A.1 product

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `capCoolNom` | Cooling capacity, nominal | 3.5 | kW | sourced | S1; S3 p.6 | 3.5 … 3.5 | locked | 11,943 BTU/h. Rated at ISO 5151 conditions, airflow MAX. |
| `capCoolMin` | Cooling capacity, catalogue min | 1.1 | kW | sourced | S1; S3 p.6 | 1.1 … 1.1 | locked | Conditional catalogue rating at rating conditions, not a universal limit. |
| `capCoolMax` | Cooling capacity, catalogue max | 3.8 | kW | sourced | S1; S3 p.6 | 3.8 … 3.8 | locked | Conditional catalogue rating. |
| `capHeatNom` | Heating capacity, nominal | 4 | kW | sourced | S1; S3 p.6 | 4 … 4 | locked | Indoor 20 DB, outdoor 7 DB / 6 WB. |
| `capHeatMin` | Heating capacity, catalogue min | 1.6 | kW | sourced | S1 (S3 p.6 states 1.3, see D2) | 1.6 … 1.6 | locked | Discrepancy D2. |
| `capHeatMax` | Heating capacity, catalogue max | 4.3 | kW | sourced | S1 (S3 p.6 states 4.6, see D2) | 4.3 … 4.3 | locked | Discrepancy D2. |
| `pInCoolNom` | System input, cooling nominal | 0.99 | kW | sourced | S1; S3 p.6 | 0.99 … 0.99 | locked | Total appliance input incl. fans and controls. |
| `pInHeatNom` | System input, heating nominal | 1.03 | kW | sourced | S1; S3 p.6 | 1.03 … 1.03 | locked |  |
| `shfNom` | Sensible heat factor, nominal | 0.88 | - | sourced | S1; S3 p.29 | 0.88 … 0.88 | locked |  |
| `dehumNom` | Dehumidification, cooling rated | 0.6 | L/h | sourced | S3 p.6 | 0.6 … 0.6 | locked |  |
| `supplyV` | Supply voltage | 230 | V | sourced | S1 220-240 V; S3 p.21 guaranteed 198-264 V | 198 … 264 | model | Single phase 50 Hz mains. Not the inverter output frequency. |
| `pfCool` | Power factor, cooling rated | 0.95 | - | sourced | S3 p.6 | 0.6 … 1 | model | Used to estimate current from power; not an inverter waveform model. |
| `pfHeat` | Power factor, heating rated | 0.95 | - | sourced | S3 p.6 | 0.6 … 1 | model |  |
| `runCurrentMax` | System running current, max | 8.46 | A | sourced | S1 | 8.46 … 8.46 | locked |  |
| `pControls` | Controls / standby power | 6 | W | assumed | assumption | 0 … 20 | model |  |

## A.2 geometry

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `indoorW` | Indoor width | 798 | mm | sourced | S1; S2 p.6/p.11 | 798 … 798 | locked |  |
| `indoorH` | Indoor height | 299 | mm | sourced | S1; S2 p.6/p.11 | 299 … 299 | locked |  |
| `indoorD` | Indoor depth | 219 | mm | sourced | S1; S2 p.6/p.11 | 219 … 219 | locked |  |
| `outdoorW` | Outdoor width | 800 | mm | sourced | S1; S3 p.6/p.11 | 800 … 800 | locked |  |
| `outdoorH` | Outdoor height | 550 | mm | sourced | S1; S3 p.6/p.11 | 550 … 550 | locked |  |
| `outdoorD` | Outdoor depth | 285 | mm | sourced | S1; S3 p.6/p.11 | 285 … 285 | locked |  |
| `pipeLen` | Interconnecting pipe length (one way) | 5 | m | sourced | S3 p.6 (rating test length) | 3 … 20 | geometry | Geometry-only: no documented line-loss model is used, so it does not change performance. |
| `pipeLenMax` | Max pipe length | 20 | m | sourced | S1 | 20 … 20 | locked |  |
| `heightDiffMax` | Max height difference | 12 | m | sourced | S1 | 12 … 12 | locked |  |

## A.3 refrigerant

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `chargeKg` | Refrigerant charge R32 (7 m) | 0.55 | kg | sourced | S1; S3 p.6 | 0.55 … 0.55 | locked | No refrigerant inventory model: charge faults are not simulated. |
| `tPickup` | Suction line heat pickup | 1 | K | assumed | assumption | 0 … 5 | model | Compressor-inlet superheat = evaporator-outlet superheat + pickup. |
| `subcool` | Condenser outlet subcooling | 4 | K | assumed | assumption (no charge inventory model) | 0 … 15 | model |  |
| `shTarget` | Target evaporator superheat | 5 | K | assumed | assumption; S3 p.40: LEV is driven from discharge temperature | 1 … 15 | model | The surrogate converts this into a discharge-temperature target. |
| `shK` | Superheat inventory gain | 1.5 | K/s per unit flow mismatch | assumed | assumption | 0.2 … 10 | model | Reduced-order evaporator dry-out dynamics. |
| `shFracMax` | Max superheated area fraction | 0.5 | - | assumed | assumption | 0.1 … 0.8 | model | f_sh = max * SH/(SH+15K). |
| `eevCv` | LEV + capillary flow coefficient (100 %) | 5.54667e-7 | m2 | calibrated | calibrated so rated opening is about 45 % | 1e-7 … 0.00001 | model | Capillary 4.0x2.4x240 mm (S3 p.18) folded into Cv. |
| `eevRate` | LEV max rate | 3 | %/s | assumed | assumption | 0.2 … 20 | model | Percent only: the pulse count is not documented. |
| `gEq` | Off-cycle pressure equalisation conductance | 25 | W/K | assumed | assumption | 0 … 200 | model |  |

## A.4 compressor

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `pPolePairs` | Compressor motor pole pairs | 2 | - | assumed | assumption | 1 … 4 | model | Electrical Hz = pole pairs x mechanical rev/s. Only used to display electrical frequency. |
| `fMin` | Min operational frequency | 13 | Hz | digitised | S3 p.23 curve start | 8 … 30 | model | Published "operational frequency" is treated as mechanical rev/s (assumption A1). |
| `fMaxCool` | Max operational frequency, cooling | 98 | Hz | digitised | S3 p.23 curve end | 60 … 120 | model | End of published correction curve; beyond it the map is extrapolated. |
| `fMaxHeat` | Max operational frequency, heating | 115 | Hz | digitised | S3 p.23 curve end | 60 … 130 | model |  |
| `fRatedCool` | Rated frequency, cooling | 84 | Hz | digitised | S3 p.23 (factor 1.0) | 84 … 84 | locked | D3: +/-2 Hz reading uncertainty. |
| `fRatedHeat` | Rated frequency, heating | 95 | Hz | digitised | S3 p.23 (factor 1.0) | 95 … 95 | locked | D3. |
| `Vd` | Compressor displacement | 0.00000963077 | m3/rev | calibrated | calibration vs S3 p.29-30 | 0.000003 … 0.000015 | model | Not published. Fitted; cross-checked against sibling KNB073 (X1, 7.3 cm3/rev) only for plausibility. |
| `etaV0` | Volumetric efficiency intercept | 0.95 | - | calibrated | calibration | 0.7 … 1 | model | eta_v = eta_v0 - a(PR-1) - b(20/f). |
| `etaVpr` | Volumetric efficiency PR slope | 0.116472 | - | calibrated | calibration vs S3 p.29-30 | 0 … 0.1 | model |  |
| `etaVlow` | Low-speed leakage term | 0.118413 | - | calibrated | calibration vs S3 p.23 | 0 … 0.3 | model |  |
| `etaIsPeak` | Isentropic efficiency peak | 0.849987 | - | calibrated | calibration | 0.4 … 0.85 | model | Map shape assumed; scale calibrated. |
| `prOpt` | Pressure ratio at peak efficiency | 3.25055 | - | calibrated | calibration | 1.5 … 5 | model |  |
| `etaIsPr` | Efficiency PR curvature | 0.0863335 | - | calibrated | calibration | 0 … 0.3 | model |  |
| `fOpt` | Peak-efficiency / field-weakening onset frequency | 60.5144 | Hz | calibrated | calibration vs S3 p.23 | 20 … 100 | model |  |
| `etaIsHi` | High-speed motor/inverter loss (field weakening) | 0.276936 | - | calibrated | calibration vs S3 p.23 | 0 … 3 | model | Applied to motor x inverter efficiency above fOpt; reproduces the steep input rise near max frequency in S3 p.23. |
| `etaIsLo` | Low-speed efficiency loss | 0.45711 | - | calibrated | calibration vs S3 p.23 | 0 … 2 | model |  |
| `etaMotorInv` | Motor x inverter efficiency | 0.88 | - | assumed | assumption | 0.7 … 0.97 | model | Losses rejected to the outdoor unit (heat sink). |
| `pInvFixed` | Compressor-drive fixed loss while running | 22.9531 | W | calibrated | calibration vs S3 p.23 | 0 … 50 | model | Rejected to the heat sink. |
| `fShell` | Shell heat loss fraction | 0.06 | - | assumed | assumption | 0 … 0.2 | model | Fraction of shaft work lost from the shell to outdoor compartment air. |

## A.5 control

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `fStart` | Start frequency hold | 30 | Hz | assumed | assumption | 13 … 60 | model | Start-up hold before modulation. |
| `tStartHold` | Start hold time | 45 | s | assumed | assumption | 0 … 300 | model |  |
| `rampUp` | Frequency ramp-up limit | 1 | Hz/s | assumed | assumption | 0.1 … 5 | model |  |
| `rampDown` | Frequency ramp-down limit | 2 | Hz/s | assumed | assumption | 0.1 … 10 | model |  |
| `defrostFinishT` | Defrost finish temperature | 5 | degC | sourced | S3 p.41 (JS soldered, initial) | 5 … 10 | model | 10 degC with JS cut. |
| `defrostMaxTime` | Defrost max duration | 600 | s | assumed | S2 p.23 "fixed time" (value not given); assumed 10 min | 120 … 900 | model |  |
| `defrostStartT` | Defrost start: outdoor coil below | -4 | degC | assumed | S2 p.23 "too low" (value not given) | -15 … 0 | model |  |
| `defrostMinRun` | Defrost start: min heating time | 1800 | s | assumed | assumption | 300 … 7200 | model |  |
| `thermoOff` | Thermo-OFF offset | -1 | K | assumed | assumption (S2 p.22 indicator bands 1-2 K) | -3 … 0 | model | Cooling: OFF below set + offset (sign reversed in heating). |
| `thermoOn` | Thermo-ON offset | 0.5 | K | assumed | assumption | 0 … 3 | model |  |
| `kp` | Frequency PI proportional gain | 12 | Hz/K | assumed | surrogate controller | 1 … 80 | model | Not reverse-engineered firmware. |
| `ki` | Frequency PI integral gain | 0.025 | Hz/(K s) | assumed | surrogate controller | 0 … 1 | model | Anti-windup by conditional integration. |
| `minOnTime` | Minimum compressor on time | 300 | s | assumed | assumption | 0 … 900 | model |  |
| `autoDwell` | AUTO changeover dwell | 900 | s | sourced | S2 p.23 (about 15 minutes) | 900 … 900 | locked |  |
| `autoBand` | AUTO changeover band | 1 | K | sourced | S2 p.23 (1 degC) | 1 … 1 | locked |  |
| `econoOffset` | ECONO COOL setpoint offset | 2 | K | sourced | S2 p.24 (9-6 (9)) | 2 … 2 | locked | Vane swing cycle not documented numerically (assumed). |
| `nightFcap` | NIGHT MODE compressor cap | 60 | Hz | assumed | S2 p.27 states outdoor noise is limited; value assumed | 20 … 98 | model |  |
| `nightOfanCap` | NIGHT MODE outdoor fan cap | 700 | rpm | assumed | assumption | 300 … 940 | model |  |
| `coldAirFanOn` | Cold-air prevention: coil temp for set fan | 32 | degC | assumed | S2 p.23 describes the function; value assumed | 20 … 45 | model |  |
| `coldAirVeryLow` | Cold-air prevention: coil temp for very Low | 26 | degC | assumed | assumption | 15 … 40 | model |  |
| `dryFmax` | DRY compressor frequency cap | 40 | Hz | assumed | assumption (DRY logic not published) | 13 … 98 | model |  |
| `dryOffset` | DRY set temperature below initial room temp | 2 | K | assumed | S2 p.22 "determined from initial room temperature" (rule assumed) | 0 … 5 | model |  |
| `ofanOnLead` | Outdoor fan on before compressor | 5 | s | sourced | S3 p.40 (10-1) | 5 … 5 | locked |  |
| `ofanOffLag` | Outdoor fan off after compressor | 15 | s | sourced | S3 p.40 (10-1) | 15 … 15 | locked |  |
| `rvLead` | 4-way valve reversal before start | 5 | s | sourced | S3 p.40 (10-2) | 5 … 5 | locked |  |
| `eevKp` | LEV PI gain | 0.4 | %/K | assumed | surrogate controller | 0 … 10 | model |  |
| `eevKi` | LEV PI integral gain | 0.006 | %/(K s) | assumed | surrogate controller | 0 … 1 | model |  |

## A.6 protection

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `restartDelay` | Compressor restart delay | 180 | s | sourced | S2 p.28 (9-13) | 180 … 180 | locked | 3-minute time delay. |
| `tdFreqDrop` | Discharge temp: frequency drop above | 111 | degC | sourced | S3 p.47 (no.19) | 111 … 111 | locked |  |
| `tdStop` | Discharge temp: compressor stop above | 116 | degC | sourced | S3 p.47 (no.10) | 116 … 116 | locked |  |
| `tdRestart` | Discharge temp: restart at or below | 100 | degC | sourced | S3 p.47 (no.10, 3 min later) | 100 … 100 | locked |  |
| `coilFrostDrop` | COOL coil frost prevention: frequency drop at or below | 8 | degC | sourced | S3 p.47 (no.18) | 8 … 8 | locked | Indoor coil thermistor. |
| `coilFrostStop` | COOL coil frost prevention: compressor stop below | 1 | degC | assumed | S2 p.22 says compressor stops when coil is too low; value assumed | -3 … 5 | model |  |
| `hpHeatDrop` | HEAT high pressure: frequency drop above | 55 | degC | sourced | S3 p.47 (no.18) | 55 … 55 | locked | Indoor coil thermistor. |
| `hpHeatStop` | HEAT high pressure: stop above | 70 | degC | sourced | S3 p.47 (no.12) | 70 … 70 | locked |  |
| `hpCoolStop` | COOL high pressure: stop above (defrost thermistor) | 70 | degC | sourced | S3 p.47 (no.12) | 70 … 70 | locked |  |
| `hpCoolDrop` | COOL high pressure: frequency drop above | 62 | degC | assumed | assumption (S3 p.40 lists the function) | 50 … 70 | model |  |
| `currentDrop` | Current protection: frequency drop above | 10 | A | sourced | S3 p.47 (no.17, approximately 10 A) | 10 … 10 | locked | Current estimated = P / (V x PF). |
| `commTimeout` | Serial signal failure stop after | 180 | s | sourced | S3 p.47 (no.4) | 180 … 180 | locked |  |
| `lowTdLimit` | Low discharge temperature limit | 50 | degC | sourced | S3 p.48 (no.21) | 50 … 50 | locked |  |
| `lowTdTime` | Low discharge temperature duration | 1200 | s | sourced | S3 p.48 (no.21, 20 min) | 1200 … 1200 | locked |  |
| `finStop` | Fin (heat sink) temperature stop | 80 | degC | sourced | S3 p.47 (no.11: 75-86 degC) | 75 … 86 | model | Mid-band value; heat-sink thermal model is assumed. |
| `finRth` | Heat-sink thermal resistance | 0.35 | K/W | assumed | assumption | 0.05 … 1 | model |  |
| `ifanFaultTime` | Indoor fan motor error detection | 12 | s | assumed | S2 p.36 names the error; timing assumed | 3 … 60 | model |  |
| `ofanFaultTime` | Outdoor fan stopped detection | 30 | s | sourced | S3 p.47 (no.14: stopped 3 times within 30 s) | 30 … 30 | locked |  |
| `envelopeCoolMax` | Cooling chart outdoor DB max | 46 | degC | sourced | S3 p.21/p.30 (data to 46 degC) | 46 … 46 | locked | Above it the map is extrapolated and flagged. |
| `envelopeHeatMin` | Guaranteed heating lower limit | -15 | degC | sourced | S3 p.22 | -15 … -15 | locked |  |

## A.7 fans

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `ifanPhi` | Indoor fan operating fraction of free delivery | 0.6 | - | assumed | assumption | 0.3 … 0.85 | model | Sets fan-curve steepness about the published operating point. |
| `ifanDpRef` | Indoor reference total pressure at Super High | 40 | Pa | assumed | assumption | 10 … 120 | model | Internal resistance of filter + coil + outlet at 684 m3/h. |
| `ifanEta` | Indoor fan+motor efficiency | 0.487436 | - | calibrated | S2 p.6 19 W / 26 W (see D4) | 0.2 … 0.8 | model |  |
| `ifanPbase` | Indoor fan motor base power | 3.4082 | W | calibrated | S2 p.6 (see D4) | 0 … 10 | model |  |
| `ifanVeryLow` | Indoor fan "very Low" speed | 400 | rpm | assumed | S2 p.22 names the step; value assumed | 250 … 500 | model | Used at thermo-OFF in COOL/DRY and in cold-air prevention. |
| `ifanRampRate` | Indoor fan acceleration | 150 | rpm/s | assumed | assumption | 20 … 1000 | model |  |
| `ofanPhi` | Outdoor fan operating fraction | 0.55 | - | assumed | assumption | 0.3 … 0.85 | model |  |
| `ofanDpRef` | Outdoor reference pressure at 940 rpm | 25 | Pa | assumed | assumption | 5 … 80 | model |  |
| `ofanPref` | Outdoor fan input at 940 rpm | 30 | W | assumed | assumption (motor current 0.22 A sourced S3 p.6) | 10 … 80 | model |  |
| `ofanRpmRef` | Outdoor fan reference speed | 940 | rpm | sourced | S3 p.6 | 940 … 940 | locked |  |
| `ofanRampRate` | Outdoor fan acceleration | 120 | rpm/s | assumed | assumption | 20 … 1000 | model |  |
| `resFilterShare` | Filter share of indoor resistance | 0.25 | - | assumed | assumption | 0.05 … 0.6 | model |  |
| `resCoilShare` | Coil share of indoor resistance | 0.45 | - | assumed | assumption | 0.1 … 0.8 | model |  |
| `resOutletShare` | Outlet/vane share of indoor resistance | 0.3 | - | assumed | assumption | 0.05 … 0.6 | model |  |

## A.8 coils

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `uaInAir` | Indoor coil air-side UA at Super High | 696.754 | W/K | calibrated | calibration vs S3 p.29-30 (Q, SHC) | 50 … 800 | model | Scales with (airflow ratio)^uaExp. |
| `uaInRef` | Indoor coil refrigerant-side UA | 597.778 | W/K | calibrated | calibration | 100 … 4000 | model |  |
| `uaOutAir` | Outdoor coil air-side UA at 2178 m3/h | 639.173 | W/K | calibrated | calibration vs S3 p.29-30 (input vs outdoor DB) | 100 … 1500 | model |  |
| `uaOutRef` | Outdoor coil refrigerant-side UA | 2242.47 | W/K | calibrated | calibration | 200 … 6000 | model |  |
| `uaExp` | Air-side UA airflow exponent | 0.6 | - | assumed | assumption (typical finned-tube) | 0.4 … 0.8 | model |  |
| `cInCoil` | Indoor coil thermal capacitance | 3500 | J/K | assumed | assumption (Al fins + Cu tube + refrigerant hold-up) | 500 … 20000 | model | Sets coil response time. |
| `cOutCoil` | Outdoor coil thermal capacitance | 7000 | J/K | assumed | assumption | 1000 … 40000 | model |  |
| `filmMax` | Water retained on indoor fins | 0.12 | kg | assumed | assumption | 0 … 0.5 | model | Re-evaporates after shutdown when fan runs. |
| `reEvapK` | Re-evaporation effectiveness | 0.35 | - | assumed | assumption | 0 … 1 | model |  |
| `frostRef` | Frost mass for 50 % air-side loss | 0.6 | kg | assumed | assumption | 0.1 … 3 | model | Reduced-order frost demonstration. |

## A.9 louvers

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `vaneRate` | Horizontal vane slew rate | 20 | deg/s | assumed | assumption (stepping motor, S2 p.24) | 2 … 90 | model |  |
| `swingPeriod` | Vertical swing period | 14 | s | assumed | assumption | 4 … 60 | model |  |
| `wideRate` | Vertical vane slew rate | 15 | deg/s | assumed | assumption | 2 … 90 | model |  |
| `widePeriod` | Horizontal swing period | 16 | s | assumed | assumption | 4 … 60 | model |  |
| `vaneAng1` | Vane angle at position 1 | 12 | deg below horizontal | assumed | positions 1-5 sourced (S2 p.24), angles assumed | 0 … 40 | model |  |
| `vaneAng5` | Vane angle at position 5 | 68 | deg below horizontal | assumed | assumption | 40 … 85 | model |  |
| `vaneAngAutoCool` | Vane angle, AUTO cool "horizontal" | 6 | deg below horizontal | assumed | S2 p.24 names "Horizontal position"; angle assumed | 0 … 20 | model |  |
| `wideMax` | Vertical vane max deflection | 40 | deg | assumed | positions 1-5 sourced (S2 p.25), angles assumed | 10 … 60 | model |  |
| `outletW` | Outlet effective width | 0.6 | m | assumed | estimated from S2 p.11 outline | 0.3 … 0.75 | model | Supported geometry: changes free area and resistance. |
| `outletH` | Outlet effective opening height | 0.065 | m | assumed | estimated | 0.03 … 0.12 | model | Supported geometry. |
| `vaneCount` | Vertical vane count | 13 | - | assumed | not documented; visual only | 6 … 24 | geometry | Visual-only geometry. |
| `vaneSpacing` | Vertical vane spacing | 0.045 | m | assumed | visual only | 0.02 … 0.08 | geometry | Visual-only geometry: no supported performance model. |

## A.10 room

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `roomW` | Room width | 4 | m | supplied | build brief demonstration room | 2.5 … 8 | model | Not a room-sizing recommendation. |
| `roomH` | Room height | 2.8 | m | supplied | build brief | 2.4 … 4 | model |  |
| `roomD` | Room depth | 4 | m | supplied | build brief | 2.5 … 8 | model |  |
| `mountH` | Indoor unit top height | 2.55 | m | assumed | assumption (S2 p.11 min 39 mm to ceiling... typical) | 1.9 … 2.75 | model | Supported geometry. |
| `mountX` | Indoor unit centre from left wall | 2 | m | assumed | assumption | 0.5 … 3.5 | model | Supported geometry. |
| `uaAirOut` | Envelope UA direct to room air (glazing) | 8 | W/K | assumed | assumption | 0 … 60 | model |  |
| `uaMassOut` | Envelope UA through walls/roof to mass node | 28 | W/K | assumed | assumption | 0 … 150 | model |  |
| `hAmass` | Air to thermal-mass conductance | 160 | W/K | assumed | assumption (about 55 m2 x 3 W/m2K) | 20 … 600 | model |  |
| `cMass` | Effective wall/furniture capacitance | 900000 | J/K | assumed | assumption | 100000 … 5000000 | model | Room cooling is not modelled with air capacity alone. |
| `ach` | Infiltration | 0.5 | 1/h | assumed | assumption | 0 … 10 | model | Open-door scenario raises it. |
| `solar` | Solar gain | 250 | W | assumed | assumption | 0 … 2000 | model |  |
| `solarToMass` | Solar fraction to mass | 0.6 | - | assumed | assumption | 0 … 1 | model |  |
| `internal` | Internal sensible gain (equipment) | 150 | W | assumed | assumption | 0 … 3000 | model |  |
| `occupants` | Occupants | 1 | - | assumed | assumption | 0 … 10 | model |  |
| `occSens` | Sensible gain per occupant | 75 | W | assumed | assumption (seated, light work) | 50 … 150 | model |  |
| `occLat` | Latent gain per occupant | 55 | W | assumed | assumption | 20 … 150 | model | Converted to moisture with h_fg; not added to the sensible balance. |

## A.11 airflow

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `jetK` | Jet throw constant K | 5 | - | assumed | assumption (entraining free-jet literature) | 2 … 8 | model | u_c = K u0 sqrt(A0)/s. |
| `jetSpread` | Jet half-width growth | 0.11 | m/m | assumed | assumption | 0.05 … 0.25 | model |  |
| `terminalV` | Throw terminal velocity | 0.25 | m/s | supplied | build brief convention | 0.1 … 1 | model | Demonstration convention. |
| `strat` | Stratification coefficient | 0.12 | K/m per K supply difference | assumed | assumption | 0 … 0.5 | model | Zonal display only, constrained to the room mean. |

## A.12 sensors

| Key | Label | Value | Unit | Status | Origin | Range | Edit | Note |
|---|---|---|---|---|---|---|---|---|
| `sensorTau` | Virtual sensor lag | 20 | s | assumed | user assumption | 0 … 300 | model | Not linked to a real instrument spec. |
| `sensorPeriod` | Virtual sensor sample period | 2 | s | assumed | user assumption | 0.1 … 60 | model |  |
| `sensorNoise` | Virtual sensor noise (1 sigma) | 0.1 | K | assumed | user assumption | 0 … 2 | model | Seeded, reproducible. |


# Appendix B: Published fan and sound data

| Indoor fan step | Cooling rpm | Cooling m³/h | Heating rpm | Heating m³/h | Sound cool dB(A) | Sound heat dB(A) |
|---|---|---|---|---|---|---|
| Silent | 500 | 294 | 500 | 294 | 19 | 19 |
| Low | 580 | 354 | 580 | 354 | 24 | 24 |
| Med | 670 | 426 | 690 | 438 | 30 | 31 |
| High | 790 | 522 | 800 | 534 | 36 | 38 |
| Super High | 970 | 684 | 1070 | 774 | 42 | 45 |

Source: S2 p.6, merged MSZ-AP25/35 column (see D1).

| Outdoor fan | rpm | m³/h |
|---|---|---|
| Cooling Low | 470 | 1038 |
| Cooling High | 940 | 2178 |
| Heating Low | 640 | 1452 |
| Heating Med | 780 | 1788 |
| Heating High | 900 | 2076 |

Source: S3 p.6.

# Appendix C: Frequency-correction curves (S3 p.23, digitised)

Factor = capacity (or input) at that frequency ÷ capacity (or input) at the rated frequency. Reading uncertainty about ±0.02 in factor and ±1.5 Hz.

## cool_cap (factor 1.0 at 84.2 Hz, range 12.5–98.1 Hz)

| Hz | factor |
|---|---|
| 12.5 | 0.304 |
| 15 | 0.315 |
| 20 | 0.351 |
| 25 | 0.393 |
| 30 | 0.439 |
| 35 | 0.482 |
| 40 | 0.539 |
| 45 | 0.592 |
| 50 | 0.645 |
| 55 | 0.7 |
| 60 | 0.754 |
| 65 | 0.808 |
| 70 | 0.861 |
| 75 | 0.913 |
| 80 | 0.962 |
| 85 | 1.015 |
| 90 | 1.048 |
| 95 | 1.079 |
| 98.1 | 1.089 |

## cool_in (factor 1.0 at 83.3 Hz, range 13–98.4 Hz)

| Hz | factor |
|---|---|
| 13 | 0.201 |
| 15 | 0.209 |
| 20 | 0.245 |
| 25 | 0.28 |
| 30 | 0.322 |
| 35 | 0.366 |
| 40 | 0.411 |
| 45 | 0.459 |
| 50 | 0.511 |
| 55 | 0.568 |
| 60 | 0.628 |
| 65 | 0.694 |
| 70 | 0.765 |
| 75 | 0.844 |
| 80 | 0.932 |
| 85 | 1.04 |
| 90 | 1.171 |
| 95 | 1.359 |
| 98.4 | 1.587 |

## heat_cap (factor 1.0 at 95.5 Hz, range 12.2–115 Hz)

| Hz | factor |
|---|---|
| 12.2 | 0.305 |
| 15 | 0.317 |
| 20 | 0.354 |
| 25 | 0.394 |
| 30 | 0.434 |
| 35 | 0.476 |
| 40 | 0.521 |
| 45 | 0.56 |
| 50 | 0.602 |
| 55 | 0.643 |
| 60 | 0.687 |
| 65 | 0.73 |
| 70 | 0.772 |
| 75 | 0.817 |
| 80 | 0.859 |
| 85 | 0.904 |
| 90 | 0.95 |
| 95 | 0.99 |
| 100 | 1.041 |
| 105 | 1.089 |
| 110 | 1.139 |
| 115 | 1.187 |
| 115 | 1.187 |

## heat_in (factor 1.0 at 95 Hz, range 12.7–115.9 Hz)

| Hz | factor |
|---|---|
| 12.7 | 0.331 |
| 15 | 0.336 |
| 20 | 0.362 |
| 25 | 0.39 |
| 30 | 0.412 |
| 35 | 0.444 |
| 40 | 0.47 |
| 45 | 0.506 |
| 50 | 0.537 |
| 55 | 0.571 |
| 60 | 0.61 |
| 65 | 0.652 |
| 70 | 0.696 |
| 75 | 0.743 |
| 80 | 0.798 |
| 85 | 0.859 |
| 90 | 0.923 |
| 95 | 1.002 |
| 100 | 1.085 |
| 105 | 1.179 |
| 110 | 1.286 |
| 115 | 1.392 |
| 115.9 | 1.398 |

# Appendix D: Cooling performance table (S3 p.29–30, 357 rows)

Rated compressor frequency, indoor airflow at MAX. Columns: indoor dry bulb, indoor wet bulb, outdoor dry bulb [°C], total capacity Q [kW], sensible capacity SHC [kW], total input [W]. Rows where SHC = Q are dry-coil rows.

**Split used in this build:** calibration = wet rows with indoor DB ∈ {24, 27, 30} and outdoor DB ∈ {21, 35, 46}; all other rows are held out for validation; dry rows are reported separately.

| Indoor DB | Indoor WB | Outdoor DB | Q kW | SHC kW | Input W |
|---|---|---|---|---|---|
| 21 | 18 | 21 | 4.11 | 2.88 | 792 |
| 21 | 20 | 21 | 4.29 | 2.49 | 832 |
| 22 | 18 | 21 | 4.11 | 3.04 | 792 |
| 22 | 20 | 21 | 4.29 | 2.66 | 832 |
| 22 | 22 | 21 | 4.46 | 2.23 | 861 |
| 23 | 18 | 21 | 4.11 | 3.21 | 792 |
| 23 | 20 | 21 | 4.29 | 2.83 | 832 |
| 23 | 22 | 21 | 4.46 | 2.41 | 861 |
| 24 | 18 | 21 | 4.11 | 3.37 | 792 |
| 24 | 20 | 21 | 4.29 | 3 | 832 |
| 24 | 22 | 21 | 4.46 | 2.59 | 861 |
| 24 | 24 | 21 | 4.69 | 2.16 | 901 |
| 25 | 18 | 21 | 4.11 | 3.54 | 792 |
| 25 | 20 | 21 | 4.29 | 3.17 | 832 |
| 25 | 22 | 21 | 4.46 | 2.77 | 861 |
| 25 | 24 | 21 | 4.69 | 2.35 | 901 |
| 26 | 18 | 21 | 4.11 | 3.7 | 792 |
| 26 | 20 | 21 | 4.29 | 3.34 | 832 |
| 26 | 22 | 21 | 4.46 | 2.95 | 861 |
| 26 | 24 | 21 | 4.69 | 2.53 | 901 |
| 26 | 26 | 21 | 4.83 | 2.03 | 950 |
| 27 | 18 | 21 | 4.11 | 3.87 | 792 |
| 27 | 20 | 21 | 4.29 | 3.52 | 832 |
| 27 | 22 | 21 | 4.46 | 3.12 | 861 |
| 27 | 24 | 21 | 4.69 | 2.72 | 901 |
| 27 | 26 | 21 | 4.83 | 2.22 | 950 |
| 28 | 18 | 21 | 4.11 | 4.03 | 792 |
| 28 | 20 | 21 | 4.29 | 3.69 | 832 |
| 28 | 22 | 21 | 4.46 | 3.3 | 861 |
| 28 | 24 | 21 | 4.69 | 2.91 | 901 |
| 28 | 26 | 21 | 4.83 | 2.42 | 950 |
| 29 | 18 | 21 | 4.11 | 4.11 | 792 |
| 29 | 20 | 21 | 4.29 | 3.86 | 832 |
| 29 | 22 | 21 | 4.46 | 3.48 | 861 |
| 29 | 24 | 21 | 4.69 | 3.1 | 901 |
| 29 | 26 | 21 | 4.83 | 2.61 | 950 |
| 30 | 18 | 21 | 4.11 | 4.11 | 792 |
| 30 | 20 | 21 | 4.29 | 4.03 | 832 |
| 30 | 22 | 21 | 4.46 | 3.66 | 861 |
| 30 | 24 | 21 | 4.69 | 3.28 | 901 |
| 30 | 26 | 21 | 4.83 | 2.8 | 950 |
| 31 | 18 | 21 | 4.11 | 4.11 | 792 |
| 31 | 20 | 21 | 4.29 | 4.2 | 832 |
| 31 | 22 | 21 | 4.46 | 3.84 | 861 |
| 31 | 24 | 21 | 4.69 | 3.47 | 901 |
| 31 | 26 | 21 | 4.83 | 2.99 | 950 |
| 32 | 18 | 21 | 4.11 | 4.11 | 792 |
| 32 | 20 | 21 | 4.29 | 4.29 | 832 |
| 32 | 22 | 21 | 4.46 | 4.02 | 861 |
| 32 | 24 | 21 | 4.69 | 3.66 | 901 |
| 32 | 26 | 21 | 4.83 | 3.19 | 950 |
| 21 | 18 | 25 | 3.94 | 2.76 | 832 |
| 21 | 20 | 25 | 4.11 | 2.39 | 881 |
| 22 | 18 | 25 | 3.94 | 2.91 | 832 |
| 22 | 20 | 25 | 4.11 | 2.55 | 881 |
| 22 | 22 | 25 | 4.31 | 2.15 | 916 |
| 23 | 18 | 25 | 3.94 | 3.07 | 832 |
| 23 | 20 | 25 | 4.11 | 2.71 | 881 |
| 23 | 22 | 25 | 4.31 | 2.32 | 916 |
| 24 | 18 | 25 | 3.94 | 3.23 | 832 |
| 24 | 20 | 25 | 4.11 | 2.88 | 881 |
| 24 | 22 | 25 | 4.31 | 2.5 | 916 |
| 24 | 24 | 25 | 4.52 | 2.08 | 950 |
| 25 | 18 | 25 | 3.94 | 3.39 | 832 |
| 25 | 20 | 25 | 4.11 | 3.04 | 881 |
| 25 | 22 | 25 | 4.31 | 2.67 | 916 |
| 25 | 24 | 25 | 4.52 | 2.26 | 950 |
| 26 | 18 | 25 | 3.94 | 3.54 | 832 |
| 26 | 20 | 25 | 4.11 | 3.21 | 881 |
| 26 | 22 | 25 | 4.31 | 2.84 | 916 |
| 26 | 24 | 25 | 4.52 | 2.44 | 950 |
| 26 | 26 | 25 | 4.69 | 1.97 | 1000 |
| 27 | 18 | 25 | 3.94 | 3.7 | 832 |
| 27 | 20 | 25 | 4.11 | 3.37 | 881 |
| 27 | 22 | 25 | 4.31 | 3.01 | 916 |
| 27 | 24 | 25 | 4.52 | 2.62 | 950 |
| 27 | 26 | 25 | 4.69 | 2.16 | 1000 |
| 28 | 18 | 25 | 3.94 | 3.86 | 832 |
| 28 | 20 | 25 | 4.11 | 3.54 | 881 |
| 28 | 22 | 25 | 4.31 | 3.19 | 916 |
| 28 | 24 | 25 | 4.52 | 2.8 | 950 |
| 28 | 26 | 25 | 4.69 | 2.35 | 1000 |
| 29 | 18 | 25 | 3.94 | 3.94 | 832 |
| 29 | 20 | 25 | 4.11 | 3.7 | 881 |
| 29 | 22 | 25 | 4.31 | 3.36 | 916 |
| 29 | 24 | 25 | 4.52 | 2.98 | 950 |
| 29 | 26 | 25 | 4.69 | 2.53 | 1000 |
| 30 | 18 | 25 | 3.94 | 3.94 | 832 |
| 30 | 20 | 25 | 4.11 | 3.87 | 881 |
| 30 | 22 | 25 | 4.31 | 3.53 | 916 |
| 30 | 24 | 25 | 4.52 | 3.16 | 950 |
| 30 | 26 | 25 | 4.69 | 2.72 | 1000 |
| 31 | 18 | 25 | 3.94 | 3.94 | 832 |
| 31 | 20 | 25 | 4.11 | 4.03 | 881 |
| 31 | 22 | 25 | 4.31 | 3.7 | 916 |
| 31 | 24 | 25 | 4.52 | 3.34 | 950 |
| 31 | 26 | 25 | 4.69 | 2.91 | 1000 |
| 32 | 18 | 25 | 3.94 | 3.94 | 832 |
| 32 | 20 | 25 | 4.11 | 4.11 | 881 |
| 32 | 22 | 25 | 4.31 | 3.87 | 916 |
| 32 | 24 | 25 | 4.52 | 3.52 | 950 |
| 32 | 26 | 25 | 4.69 | 3.1 | 1000 |
| 21 | 18 | 27 | 3.78 | 2.65 | 871 |
| 21 | 20 | 27 | 3.99 | 2.31 | 901 |
| 22 | 18 | 27 | 3.78 | 2.8 | 871 |
| 22 | 20 | 27 | 3.99 | 2.47 | 901 |
| 22 | 22 | 27 | 4.2 | 2.1 | 941 |
| 23 | 18 | 27 | 3.78 | 2.95 | 871 |
| 23 | 20 | 27 | 3.99 | 2.63 | 901 |
| 23 | 22 | 27 | 4.2 | 2.27 | 941 |
| 24 | 18 | 27 | 3.78 | 3.1 | 871 |
| 24 | 20 | 27 | 3.99 | 2.79 | 901 |
| 24 | 22 | 27 | 4.2 | 2.44 | 941 |
| 24 | 24 | 27 | 4.41 | 2.03 | 980 |
| 25 | 18 | 27 | 3.78 | 3.25 | 871 |
| 25 | 20 | 27 | 3.99 | 2.95 | 901 |
| 25 | 22 | 27 | 4.2 | 2.6 | 941 |
| 25 | 24 | 27 | 4.41 | 2.21 | 980 |
| 26 | 18 | 27 | 3.78 | 3.4 | 871 |
| 26 | 20 | 27 | 3.99 | 3.11 | 901 |
| 26 | 22 | 27 | 4.2 | 2.77 | 941 |
| 26 | 24 | 27 | 4.41 | 2.38 | 980 |
| 26 | 26 | 27 | 4.62 | 1.94 | 1030 |
| 27 | 18 | 27 | 3.78 | 3.55 | 871 |
| 27 | 20 | 27 | 3.99 | 3.27 | 901 |
| 27 | 22 | 27 | 4.2 | 2.94 | 941 |
| 27 | 24 | 27 | 4.41 | 2.56 | 980 |
| 27 | 26 | 27 | 4.62 | 2.13 | 1030 |
| 28 | 18 | 27 | 3.78 | 3.7 | 871 |
| 28 | 20 | 27 | 3.99 | 3.43 | 901 |
| 28 | 22 | 27 | 4.2 | 3.11 | 941 |
| 28 | 24 | 27 | 4.41 | 2.73 | 980 |
| 28 | 26 | 27 | 4.62 | 2.31 | 1030 |
| 29 | 18 | 27 | 3.78 | 3.78 | 871 |
| 29 | 20 | 27 | 3.99 | 3.59 | 901 |
| 29 | 22 | 27 | 4.2 | 3.28 | 941 |
| 29 | 24 | 27 | 4.41 | 2.91 | 980 |
| 29 | 26 | 27 | 4.62 | 2.49 | 1030 |
| 30 | 18 | 27 | 3.78 | 3.78 | 871 |
| 30 | 20 | 27 | 3.99 | 3.75 | 901 |
| 30 | 22 | 27 | 4.2 | 3.44 | 941 |
| 30 | 24 | 27 | 4.41 | 3.09 | 980 |
| 30 | 26 | 27 | 4.62 | 2.68 | 1030 |
| 31 | 18 | 27 | 3.78 | 3.78 | 871 |
| 31 | 20 | 27 | 3.99 | 3.91 | 901 |
| 31 | 22 | 27 | 4.2 | 3.61 | 941 |
| 31 | 24 | 27 | 4.41 | 3.26 | 980 |
| 31 | 26 | 27 | 4.62 | 2.86 | 1030 |
| 32 | 18 | 27 | 3.78 | 3.78 | 871 |
| 32 | 20 | 27 | 3.99 | 3.99 | 901 |
| 32 | 22 | 27 | 4.2 | 3.78 | 941 |
| 32 | 24 | 27 | 4.41 | 3.44 | 980 |
| 32 | 26 | 27 | 4.62 | 3.05 | 1030 |
| 21 | 18 | 30 | 3.64 | 2.55 | 911 |
| 21 | 20 | 30 | 3.85 | 2.23 | 941 |
| 22 | 18 | 30 | 3.64 | 2.69 | 911 |
| 22 | 20 | 30 | 3.85 | 2.39 | 941 |
| 22 | 22 | 30 | 4.03 | 2.01 | 980 |
| 23 | 18 | 30 | 3.64 | 2.84 | 911 |
| 23 | 20 | 30 | 3.85 | 2.54 | 941 |
| 23 | 22 | 30 | 4.03 | 2.17 | 980 |
| 24 | 18 | 30 | 3.64 | 2.98 | 911 |
| 24 | 20 | 30 | 3.85 | 2.7 | 941 |
| 24 | 22 | 30 | 4.03 | 2.33 | 980 |
| 24 | 24 | 30 | 4.27 | 1.96 | 1030 |
| 25 | 18 | 30 | 3.64 | 3.13 | 911 |
| 25 | 20 | 30 | 3.85 | 2.85 | 941 |
| 25 | 22 | 30 | 4.03 | 2.5 | 980 |
| 25 | 24 | 30 | 4.27 | 2.14 | 1030 |
| 26 | 18 | 30 | 3.64 | 3.28 | 911 |
| 26 | 20 | 30 | 3.85 | 3 | 941 |
| 26 | 22 | 30 | 4.03 | 2.66 | 980 |
| 26 | 24 | 30 | 4.27 | 2.31 | 1030 |
| 26 | 26 | 30 | 4.48 | 1.88 | 1059 |
| 27 | 18 | 30 | 3.64 | 3.42 | 911 |
| 27 | 20 | 30 | 3.85 | 3.16 | 941 |
| 27 | 22 | 30 | 4.03 | 2.82 | 980 |
| 27 | 24 | 30 | 4.27 | 2.48 | 1030 |
| 27 | 26 | 30 | 4.48 | 2.06 | 1059 |
| 28 | 18 | 30 | 3.64 | 3.57 | 911 |
| 28 | 20 | 30 | 3.85 | 3.31 | 941 |
| 28 | 22 | 30 | 4.03 | 2.98 | 980 |
| 28 | 24 | 30 | 4.27 | 2.65 | 1030 |
| 28 | 26 | 30 | 4.48 | 2.24 | 1059 |
| 29 | 18 | 30 | 3.64 | 3.64 | 911 |
| 29 | 20 | 30 | 3.85 | 3.47 | 941 |
| 29 | 22 | 30 | 4.03 | 3.14 | 980 |
| 29 | 24 | 30 | 4.27 | 2.82 | 1030 |
| 29 | 26 | 30 | 4.48 | 2.42 | 1059 |
| 30 | 18 | 30 | 3.64 | 3.64 | 911 |
| 30 | 20 | 30 | 3.85 | 3.62 | 941 |
| 30 | 22 | 30 | 4.03 | 3.3 | 980 |
| 30 | 24 | 30 | 4.27 | 2.99 | 1030 |
| 30 | 26 | 30 | 4.48 | 2.6 | 1059 |
| 31 | 18 | 30 | 3.64 | 3.64 | 911 |
| 31 | 20 | 30 | 3.85 | 3.77 | 941 |
| 31 | 22 | 30 | 4.03 | 3.46 | 980 |
| 31 | 24 | 30 | 4.27 | 3.16 | 1030 |
| 31 | 26 | 30 | 4.48 | 2.78 | 1059 |
| 32 | 18 | 30 | 3.64 | 3.64 | 911 |
| 32 | 20 | 30 | 3.85 | 3.85 | 941 |
| 32 | 22 | 30 | 4.03 | 3.62 | 980 |
| 32 | 24 | 30 | 4.27 | 3.33 | 1030 |
| 32 | 26 | 30 | 4.48 | 2.96 | 1059 |
| 21 | 18 | 35 | 3.43 | 2.4 | 970 |
| 21 | 20 | 35 | 3.61 | 2.09 | 1010 |
| 22 | 18 | 35 | 3.43 | 2.54 | 970 |
| 22 | 20 | 35 | 3.61 | 2.24 | 1010 |
| 22 | 22 | 35 | 3.82 | 1.91 | 1049 |
| 23 | 18 | 35 | 3.43 | 2.68 | 970 |
| 23 | 20 | 35 | 3.61 | 2.38 | 1010 |
| 23 | 22 | 35 | 3.82 | 2.06 | 1049 |
| 24 | 18 | 35 | 3.43 | 2.81 | 970 |
| 24 | 20 | 35 | 3.61 | 2.52 | 1010 |
| 24 | 22 | 35 | 3.82 | 2.21 | 1049 |
| 24 | 24 | 35 | 4.03 | 1.85 | 1089 |
| 25 | 18 | 35 | 3.43 | 2.95 | 970 |
| 25 | 20 | 35 | 3.61 | 2.67 | 1010 |
| 25 | 22 | 35 | 3.82 | 2.37 | 1049 |
| 25 | 24 | 35 | 4.03 | 2.01 | 1089 |
| 26 | 18 | 35 | 3.43 | 3.09 | 970 |
| 26 | 20 | 35 | 3.61 | 2.81 | 1010 |
| 26 | 22 | 35 | 3.82 | 2.52 | 1049 |
| 26 | 24 | 35 | 4.03 | 2.17 | 1089 |
| 26 | 26 | 35 | 4.24 | 1.78 | 1129 |
| 27 | 18 | 35 | 3.43 | 3.22 | 970 |
| 27 | 20 | 35 | 3.61 | 2.96 | 1010 |
| 27 | 22 | 35 | 3.82 | 2.67 | 1049 |
| 27 | 24 | 35 | 4.03 | 2.33 | 1089 |
| 27 | 26 | 35 | 4.24 | 1.95 | 1129 |
| 28 | 18 | 35 | 3.43 | 3.36 | 970 |
| 28 | 20 | 35 | 3.61 | 3.1 | 1010 |
| 28 | 22 | 35 | 3.82 | 2.82 | 1049 |
| 28 | 24 | 35 | 4.03 | 2.5 | 1089 |
| 28 | 26 | 35 | 4.24 | 2.12 | 1129 |
| 29 | 18 | 35 | 3.43 | 3.43 | 970 |
| 29 | 20 | 35 | 3.61 | 3.24 | 1010 |
| 29 | 22 | 35 | 3.82 | 2.98 | 1049 |
| 29 | 24 | 35 | 4.03 | 2.66 | 1089 |
| 29 | 26 | 35 | 4.24 | 2.29 | 1129 |
| 30 | 18 | 35 | 3.43 | 3.43 | 970 |
| 30 | 20 | 35 | 3.61 | 3.39 | 1010 |
| 30 | 22 | 35 | 3.82 | 3.13 | 1049 |
| 30 | 24 | 35 | 4.03 | 2.82 | 1089 |
| 30 | 26 | 35 | 4.24 | 2.46 | 1129 |
| 31 | 18 | 35 | 3.43 | 3.43 | 970 |
| 31 | 20 | 35 | 3.61 | 3.53 | 1010 |
| 31 | 22 | 35 | 3.82 | 3.28 | 1049 |
| 31 | 24 | 35 | 4.03 | 2.98 | 1089 |
| 31 | 26 | 35 | 4.24 | 2.63 | 1129 |
| 32 | 18 | 35 | 3.43 | 3.43 | 970 |
| 32 | 20 | 35 | 3.61 | 3.61 | 1010 |
| 32 | 22 | 35 | 3.82 | 3.43 | 1049 |
| 32 | 24 | 35 | 4.03 | 3.14 | 1089 |
| 32 | 26 | 35 | 4.24 | 2.8 | 1129 |
| 21 | 18 | 40 | 3.15 | 2.21 | 1030 |
| 21 | 20 | 40 | 3.36 | 1.95 | 1059 |
| 22 | 18 | 40 | 3.15 | 2.33 | 1030 |
| 22 | 20 | 40 | 3.36 | 2.08 | 1059 |
| 22 | 22 | 40 | 3.57 | 1.79 | 1109 |
| 23 | 18 | 40 | 3.15 | 2.46 | 1030 |
| 23 | 20 | 40 | 3.36 | 2.22 | 1059 |
| 23 | 22 | 40 | 3.57 | 1.93 | 1109 |
| 24 | 18 | 40 | 3.15 | 2.58 | 1030 |
| 24 | 20 | 40 | 3.36 | 2.35 | 1059 |
| 24 | 22 | 40 | 3.57 | 2.07 | 1109 |
| 24 | 24 | 40 | 3.78 | 1.74 | 1139 |
| 25 | 18 | 40 | 3.15 | 2.71 | 1030 |
| 25 | 20 | 40 | 3.36 | 2.49 | 1059 |
| 25 | 22 | 40 | 3.57 | 2.21 | 1109 |
| 25 | 24 | 40 | 3.78 | 1.89 | 1139 |
| 26 | 18 | 40 | 3.15 | 2.84 | 1030 |
| 26 | 20 | 40 | 3.36 | 2.62 | 1059 |
| 26 | 22 | 40 | 3.57 | 2.36 | 1109 |
| 26 | 24 | 40 | 3.78 | 2.04 | 1139 |
| 26 | 26 | 40 | 3.99 | 1.68 | 1178 |
| 27 | 18 | 40 | 3.15 | 2.96 | 1030 |
| 27 | 20 | 40 | 3.36 | 2.76 | 1059 |
| 27 | 22 | 40 | 3.57 | 2.5 | 1109 |
| 27 | 24 | 40 | 3.78 | 2.19 | 1139 |
| 27 | 26 | 40 | 3.99 | 1.84 | 1178 |
| 28 | 18 | 40 | 3.15 | 3.09 | 1030 |
| 28 | 20 | 40 | 3.36 | 2.89 | 1059 |
| 28 | 22 | 40 | 3.57 | 2.64 | 1109 |
| 28 | 24 | 40 | 3.78 | 2.34 | 1139 |
| 28 | 26 | 40 | 3.99 | 2 | 1178 |
| 29 | 18 | 40 | 3.15 | 3.15 | 1030 |
| 29 | 20 | 40 | 3.36 | 3.02 | 1059 |
| 29 | 22 | 40 | 3.57 | 2.78 | 1109 |
| 29 | 24 | 40 | 3.78 | 2.49 | 1139 |
| 29 | 26 | 40 | 3.99 | 2.15 | 1178 |
| 30 | 18 | 40 | 3.15 | 3.15 | 1030 |
| 30 | 20 | 40 | 3.36 | 3.16 | 1059 |
| 30 | 22 | 40 | 3.57 | 2.93 | 1109 |
| 30 | 24 | 40 | 3.78 | 2.65 | 1139 |
| 30 | 26 | 40 | 3.99 | 2.31 | 1178 |
| 31 | 18 | 40 | 3.15 | 3.15 | 1030 |
| 31 | 20 | 40 | 3.36 | 3.29 | 1059 |
| 31 | 22 | 40 | 3.57 | 3.07 | 1109 |
| 31 | 24 | 40 | 3.78 | 2.8 | 1139 |
| 31 | 26 | 40 | 3.99 | 2.47 | 1178 |
| 32 | 18 | 40 | 3.15 | 3.15 | 1030 |
| 32 | 20 | 40 | 3.36 | 3.36 | 1059 |
| 32 | 22 | 40 | 3.57 | 3.21 | 1109 |
| 32 | 24 | 40 | 3.78 | 2.95 | 1139 |
| 32 | 26 | 40 | 3.99 | 2.63 | 1178 |
| 21 | 18 | 46 | 2.91 | 2.03 | 1069 |
| 21 | 20 | 46 | 3.12 | 1.81 | 1119 |
| 22 | 18 | 46 | 2.91 | 2.15 | 1069 |
| 22 | 20 | 46 | 3.12 | 1.93 | 1119 |
| 22 | 22 | 46 | 3.33 | 1.66 | 1148 |
| 23 | 18 | 46 | 2.91 | 2.27 | 1069 |
| 23 | 20 | 46 | 3.12 | 2.06 | 1119 |
| 23 | 22 | 46 | 3.33 | 1.8 | 1148 |
| 24 | 18 | 46 | 2.91 | 2.38 | 1069 |
| 24 | 20 | 46 | 3.12 | 2.18 | 1119 |
| 24 | 22 | 46 | 3.33 | 1.93 | 1148 |
| 24 | 24 | 46 | 3.57 | 1.64 | 1188 |
| 25 | 18 | 46 | 2.91 | 2.5 | 1069 |
| 25 | 20 | 46 | 3.12 | 2.31 | 1119 |
| 25 | 22 | 46 | 3.33 | 2.06 | 1148 |
| 25 | 24 | 46 | 3.57 | 1.79 | 1188 |
| 26 | 18 | 46 | 2.91 | 2.61 | 1069 |
| 26 | 20 | 46 | 3.12 | 2.43 | 1119 |
| 26 | 22 | 46 | 3.33 | 2.19 | 1148 |
| 26 | 24 | 46 | 3.57 | 1.93 | 1188 |
| 26 | 26 | 46 | 3.75 | 1.57 | 1228 |
| 27 | 18 | 46 | 2.91 | 2.73 | 1069 |
| 27 | 20 | 46 | 3.12 | 2.55 | 1119 |
| 27 | 22 | 46 | 3.33 | 2.33 | 1148 |
| 27 | 24 | 46 | 3.57 | 2.07 | 1188 |
| 27 | 26 | 46 | 3.75 | 1.72 | 1228 |
| 28 | 18 | 46 | 2.91 | 2.85 | 1069 |
| 28 | 20 | 46 | 3.12 | 2.68 | 1119 |
| 28 | 22 | 46 | 3.33 | 2.46 | 1148 |
| 28 | 24 | 46 | 3.57 | 2.21 | 1188 |
| 28 | 26 | 46 | 3.75 | 1.87 | 1228 |
| 29 | 18 | 46 | 2.91 | 2.91 | 1069 |
| 29 | 20 | 46 | 3.12 | 2.8 | 1119 |
| 29 | 22 | 46 | 3.33 | 2.59 | 1148 |
| 29 | 24 | 46 | 3.57 | 2.36 | 1188 |
| 29 | 26 | 46 | 3.75 | 2.02 | 1228 |
| 30 | 18 | 46 | 2.91 | 2.91 | 1069 |
| 30 | 20 | 46 | 3.12 | 2.93 | 1119 |
| 30 | 22 | 46 | 3.33 | 2.73 | 1148 |
| 30 | 24 | 46 | 3.57 | 2.5 | 1188 |
| 30 | 26 | 46 | 3.75 | 2.17 | 1228 |
| 31 | 18 | 46 | 2.91 | 2.91 | 1069 |
| 31 | 20 | 46 | 3.12 | 3.05 | 1119 |
| 31 | 22 | 46 | 3.33 | 2.86 | 1148 |
| 31 | 24 | 46 | 3.57 | 2.64 | 1188 |
| 31 | 26 | 46 | 3.75 | 2.32 | 1228 |
| 32 | 18 | 46 | 2.91 | 2.91 | 1069 |
| 32 | 20 | 46 | 3.12 | 3.12 | 1119 |
| 32 | 22 | 46 | 3.33 | 2.99 | 1148 |
| 32 | 24 | 46 | 3.57 | 2.78 | 1188 |
| 32 | 26 | 46 | 3.75 | 2.47 | 1228 |
