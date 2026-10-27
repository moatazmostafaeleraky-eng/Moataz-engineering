# Model notes

This file describes what the simulator computes, where the boundaries of each balance are, which parts come from published data, and where the model stops being trustworthy. Every parameter is listed with its status (sourced, digitised, calibrated, assumed, supplied) in [PARAMETERS.md](PARAMETERS.md). The sources are listed in [SOURCE_REGISTER.md](SOURCE_REGISTER.md).

## 1. Structure

The model is reduced-order and lumped, not a CFD or finite-volume model.

| Block | State variables | Time constant handled |
|---|---|---|
| Room air | `Troom`, humidity ratio `wroom` | minutes |
| Room thermal mass | `Tmass` (walls/furniture lump) | tens of minutes |
| Indoor coil | refrigerant saturation `Te`/`Tc`, coil metal, condensate film, frost (outdoor coil in heating) | seconds to minutes |
| Outdoor coil | saturation temperature, frost mass | seconds to minutes |
| Refrigerant side | evaporator-outlet superheat (integrator on compressor vs LEV mass-flow mismatch) | seconds |
| Actuators | compressor Hz (ramp-limited), fan rpm (first order), LEV opening (slew), vane angles (slew) | seconds |
| Controller | supervisor state, PI integrator, timers, latched faults, defrost state | discrete |

The fixed step is 0.1 s. Halving the step changes the settled outputs by less than 0.003 % (test *acceptance 4*). Faster-than-real-time playback runs more of the same steps; it never uses a larger step.

## 2. Properties

- **R32**: offline tables generated from CoolProp 8.0.0 (`scripts/gen_r32_tables.py`). The tables are aligned to the saturation boundary: saturation temperature × superheat or subcooling offset. The table error against CoolProp check points off the grid is ≤ 0.005 % in enthalpy. Quality is reported only inside the dome.
- **Moist air**: ASHRAE Fundamentals psychrometrics (Hyland–Wexler saturation pressure). The model never allows humidity ratio < 0 or RH > 100 %.

## 3. Component equations

**Compressor** (rolling-piston rotary KVB073FYXMC; internals are not published, so this is a surrogate map):

- `ṁ = ηv · ρ_suction · Vd · f`, with `ηv = ηv0 − ηv,pr (PR − 1) − ηv,low · 20/f`
- `ηis = ηis,peak · (1 − ηis,pr (PR/PRopt − 1)²) · (1 − ηis,lo · lo²)`, where `lo = max(0, (fOpt − f)/fOpt)`
- Motor + inverter: `ηmi = ηmi0 (1 − ηis,hi · hi²)` above `fOpt` (field-weakening loss), plus a fixed drive loss `P_inv,fixed`
- Shell heat `Q_shell = f_shell · W_shaft` goes to the outdoor air stream; the discharge enthalpy is `h1 + (W_shaft − Q_shell)/ṁ`.

**LEV + capillary**: orifice flow `ṁ = Cv · opening · √(2 ρ_liquid ΔP)`. The opening is shown in %, because the pulse count of the real LEV is not documented. The LEV controller is a PI on a discharge-temperature target (surrogate). With a closed LEV the superheat rises; with an over-open LEV the suction quality falls below 1. Liquid carry-over is handled by a mixing model, so the compressor sees a two-phase suction state and the discharge temperature falls (test: 79 → 42 °C at 100 % LEV, suction quality 0.80).

**Coils**: bypass-factor / apparatus-dew-point model, with a surface temperature solved so that air-side heat equals refrigerant-side heat (`uaAir`, `uaRef`). A wet coil removes moisture. Condensate leaves at the surface enthalpy and is bookkept as film plus drain tray; it is never deleted (test: 0.416 kg condensed = 0.416 kg bookkept). Air-side UA scales with airflow (`∝ q^0.6`) and with fouling. Frost on the outdoor coil reduces UA and airflow.

**Fans**: the published rpm–airflow tables (S2 p.6 indoor, S3 p.6 outdoor) are used directly at the reference resistance. Cooling and heating points lie on one curve within 1 %, so they are merged. A change in resistance moves the operating point along an assumed quadratic fan curve: `dp = P0 (1 − (Q/Qf)²)` intersected with `k · r · Q²`. Indoor resistance is split into filter, coil and outlet shares (assumed 0.25 / 0.45 / 0.30). A closed vane, a narrower outlet, a dirty filter or a fouled coil therefore lower the airflow. Fan power comes from the calibrated efficiency and a base loss.

**Vane direction alone does not create capacity.** With a fixed resistance, `Qnet` is identical at 5°, 35° and 65° (2797 W in the test). The vane changes the jet direction, the occupied-zone temperature, draft and uniformity. It changes capacity only through the outlet free area, which is a geometry change.

## 4. Room and air distribution

- **Room node**: a sensible and latent balance with envelope UA, infiltration (ACH), solar, internal and occupant gains, plus a separate thermal-mass node. The room energy residual over a 30-minute transient, storage included, is 0.70 %.
- **Chamber mode**: pins the room state to test conditions. It is used for the rating-point tests.
- **Airflow field** (`model/airfield.ts`): an entraining, buoyant jet traced from the actual vane angles, over a zonal grid of 20 × 14 × 20.
  - Potential core length `jetK·√A`, then velocity decaying as `1/s`.
  - Spread `b = 0.5√A + k·s`.
  - Buoyancy curvature from `g β ΔT / u²`.
  - The jet attaches to a wall or ceiling when it reaches one (wall-jet). Desk, bed and wardrobe obstacles deflect it, with a wake loss.
  - The field is constrained to the room-node mean and time-averaged over 20 s, which captures swing. The comfort zones are desk, bed and whole occupied zone, with mean, standard deviation and draft fraction.
  - **It is an approximate airflow model, not CFD**, and the app says so on every airflow view.
- **Separate air circuits**: indoor and outdoor air never mix. Indoor particles stay at `z ≥ 0` and outdoor particles stay outside the wall (the test checks max world `z = −0.24` against the wall face at `−0.22`).

## 5. Control (surrogate of the documented behaviour)

S2 §9 and S3 §10 describe *what* the microprocessor does. Most thresholds and all gains are not published. Every value in the controller is therefore labelled sourced or assumed in the registry.

- **Supervisor states**: OFF, STANDBY, START_DELAY, STARTING, COOLING, HEATING, DRY, FAN_ONLY, MODULATING, STOPPING, DEFROST, PROTECTION, FAULT. The current state and a one-line reason are always shown.
- **Frequency**: PI on room error (`kp 12 Hz/K`, `ki 0.025 Hz/(K s)`), with conditional-integration anti-windup, ramp limits of +1 Hz/s and −2 Hz/s (assumed), the envelope `fMin`…`fMax`, and limiter caps. The tightest active cap wins and is named, e.g. "High pressure, COOL (assumed)".
- **Sourced timings and limits**:
  - 3-minute restart delay
  - outdoor fan on 5 s before and off 15 s after the compressor
  - 4-way valve reversal 5 s before start
  - discharge temperature 111 °C frequency drop, 116 °C stop, restart ≤ 100 °C
  - coil frost prevention ≤ 8 °C
  - HEAT high pressure 55 °C drop, 70 °C stop
  - current about 10 A
  - serial failure after 180 s
  - low discharge temperature 50 °C for 20 min
  - fin temperature 75–86 °C
  - defrost finish temperature 5 °C
- **Assumed**:
  - thermo-off/on offsets
  - defrost start condition (coil below −4 °C after 30 min of heating) and 10-minute maximum
  - DRY rule and its 40 Hz cap
  - cold-air prevention temperatures
  - COOL high-pressure drop point
  - all vane angles (the positions 1–5 are sourced, the angles are not)
  - NIGHT MODE caps
  - fan-fault detection time
- **Defrost**: the cycle reverses, both fans stop and frost melts until the coil reaches the finish temperature or the time limit. The restart delay is **not** applied when heating resumes after defrost (assumption: the compressor is not stopped for a protection or by the user). Without this exemption the room would be left without heat for 3 minutes after every defrost.
- **Faults**: a protection that stops the unit latches as FAULT with a simulator code (SIM-Fxx, cross-referenced to the S2/S3 troubleshooting tables, not the unit's real blink codes). **Reset rule**: the cause must be removed **and** power cycled (STOP then OPERATE) before the unit restarts.
- **AUTO mode**: the documented 15 min / 1 °C changeover. **ECONO COOL**: +2 K setpoint plus swing. **NIGHT**: caps. **i-save**: two presets.
- **Overrides**: manual Hz, rpm, LEV % and vane angles go through the same envelope and protections. Requesting 140 Hz gives about 30 Hz while a high-pressure limit is active, and the limiting reason is shown.

## 6. Energy balance boundaries

| Balance | Boundary | Result (test) |
|---|---|---|
| Core cycle | refrigerant: evaporator + compressor work = condenser | residual ≈ 0 |
| Whole system | outdoor air temperature rise vs. indoor heat removed + all electrical input (both units) | −0.40 % |
| Room transient | ΔU of air + mass vs. ∫gains − ∫removed | 0.70 % |
| Moisture | condensed water vs. tray + film | exact |

## 7. Calibration status

The following are **calibrated** against the published S3 p.29–30 performance table (39 calibration rows), the S3 p.23 cooling frequency-correction curves, and the two rated points:

- compressor displacement and efficiency map
- coil UA values
- indoor fan efficiency
- LEV Cv

The remaining 283 table rows and the heating frequency curve at 20/40/60/80/100/110 Hz are **held out**. See [CALIBRATION_GUIDE.md](CALIBRATION_GUIDE.md).

Things to be aware of:

- `etaIsPeak` ended at its upper bound (0.85). The fit wants a slightly more efficient compressor at the rated pressure ratio than the bound allows.
- The calibrated effective displacement is 9.6 cm³/rev. The only public number for a related compressor is 7.3 cm³/rev for the KNB073 sibling (secondary source X1, not this model). The calibrated value is an *effective* parameter: it also absorbs the inferred rated frequency (D3, about 84 Hz cooling) and any error in the volumetric-efficiency form. Do not read it as a measured swept volume.
- A good calibration fit is agreement with published data, not experimental proof.

## 8. Validity range

| Quantity | Validated against data | Extrapolated (flagged in the app) |
|---|---|---|
| Outdoor DB, cooling | 21–46 °C (table) | below 21 °C, above 46 °C |
| Indoor WB, cooling | 15–23 °C | outside |
| Compressor frequency | correction curves 20–95 Hz (cooling), 20–110 Hz (heating) | outside |
| Fan speed | published rpm table | affinity extrapolation outside the table |
| Heating | rated point and frequency curve; no heating table | low-ambient capacity, defrost timing |

## 9. Known gaps (real, not hidden)

1. **SHF at rating (D6)**: the published data imply SHF 0.88 at 684 m³/h, which would need leaving air above saturation. The model reports about 0.84. The dry rows of the table (SHF 1.0) have a 5.0 % capacity RMSE, worse than the wet rows.
2. **Catalogue minimum capacity**: at `fMin` the model gives 0.90 kW vs. the catalogue 1.1 kW (−18 %). The real controller's minimum operating point is not published and may use a higher effective minimum frequency or a different fan step.
3. **No refrigerant charge or inventory model**: undercharge and overcharge faults are not offered.
4. **Compressor internals in 3D are conceptual**, as are the PCB layout and the fan blade counts. The labels say so.
5. **Thresholds that are not published are assumed** (see §5). They are editable in Design Lab, never in the reference profile.
6. **Transient calibration is not automated**. Lab CSV calibration fits steady rows only; transients are compared visually in Timeline/Trends.
7. **Room geometry edits**: the thermal model and the airflow grid use the edited dimensions, but the 3D room is always drawn 4 × 4 m.
8. **A/B in 3D**: there are no side-by-side 3D viewports. A/B uses common-scale 2D slices, metric tables and a ghost jet line for run B in the main 3D view.
9. **Sound**: the published sound pressure levels are shown as data. The in-app audio is a synthesised illustration, not dB(A).
10. **Batch cancel** is cooperative between runs. Inside a single long run, cancel falls back to stopping the batch worker after 2 s, so that job returns no partial result.
