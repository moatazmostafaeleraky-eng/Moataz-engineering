# Calibration guide

## What is fitted, and to what

| Parameter | Meaning | Bounds | Fitted value |
|---|---|---|---|
| `Vd` | effective displacement | 4–12 cm³/rev | 9.63 cm³/rev |
| `etaIsPeak` | peak isentropic efficiency | 0.50–0.85 | 0.850 (at bound) |
| `etaIsPr`, `prOpt` | efficiency fall-off with pressure ratio | 0–0.25, 1.8–4.5 | 0.086, 3.25 |
| `fOpt`, `etaIsLo`, `etaIsHi` | low-speed and high-speed (field-weakening) losses | 35–90 Hz, 0–1.5, 0–4 | 60.5 Hz, 0.457, 0.277 |
| `etaVlow`, `etaVpr` | volumetric-efficiency terms | 0–0.15, 0–0.12 | 0.118, 0.1165 |
| `pInvFixed` | fixed drive loss | 0–70 W | 22.95 W |
| `uaInAir`, `uaInRef` | indoor coil air / refrigerant conductance | 100–1200, 200–4000 W/K | 696.8, 597.8 |
| `uaOutAir`, `uaOutRef` | outdoor coil air / refrigerant conductance | 150–1500, 300–6000 W/K | 639.2, 2242.5 |
| `ifanEta`, `ifanPbase` | indoor fan efficiency and base loss | from 19 W / 26 W at Super High (D4) | 0.487, 3.41 W |
| `eevCv` | LEV flow coefficient | LEV at 45 % opening at the rated point (assumption) | 5.55·10⁻⁷ |

**Calibration data:**

- S3 p.29–30 performance table, cooling: indoor DB 24/27/30 °C × outdoor DB 21/35/46 °C, all wet-bulb rows at those points. That is 39 rows.
- S3 p.23 cooling capacity and input frequency-correction curves.
- Both rated points, cooling and heating.
- The heating frequency curve at 30/50/70/90 Hz.

**Held out for validation:**

- The other 283 table rows.
- The heating frequency curve at the remaining frequencies.
- The catalogue min/max capacity.

**Method:** Nelder–Mead (`scripts/calibrate.ts`) on sigmoid-bounded parameters. The objective is relative error on:

- capacity and input of the calibration rows; the SHC column has weight 0.3 because of D6
- both frequency curves
- the rated points, with a strong weight

It also includes weak priors (normalised by the bound width) that keep poorly identifiable parameters near plausible values.

## Re-running

```bash
CAL_EVALS=10000 npm run calibrate     # writes src/config/calibration.json and docs/calibration_report.json
npm test                              # acceptance tests must still pass
npm run validate                      # held-out statistics -> docs/validation_report.json
npm run build
```

The registry reads `src/config/calibration.json` at build time and marks those parameters as *calibrated*.

## Current result

| Check | Result |
|---|---|
| Rated cooling, dynamic simulator in chamber mode | 3.508 kW (+0.2 %), 0.998 kW input (+0.8 %), COP 3.51 |
| Rated heating, dynamic simulator in chamber mode | 3.990 kW (−0.3 %), 1.027 kW input (−0.3 %), COP 3.89 |
| Table, calibration rows (n = 39) | capacity RMSE 2.17 %, input RMSE 3.70 % |
| Table, held-out rows (n = 283) | capacity RMSE 2.14 % (max 4.75 %), input RMSE 3.09 % (max 10.74 %) |
| Table, dry rows (n = 35) | capacity RMSE 5.00 % (max 12.6 %) |
| Heating frequency curve, held-out | capacity factor RMSE 0.041 |
| Catalogue max cooling at `fMaxCool` | 3.81 kW vs 3.8 |
| Catalogue min cooling at `fMin` | 0.90 kW vs 1.1 (−18 %, known gap) |

## Calibrating with your own lab data (in the app)

Go to **Design Lab → Lab evidence**.

1. Click **Download column template**. Columns carry units in brackets, e.g. `indoor_db [degC]`, `comp_hz [Hz]` and `capacity [W]`. Unknown columns are ignored and listed. Missing cells stay missing; nothing is interpolated.
2. Click **Import lab CSV**. Rows marked `steady = 1` are used for fitting.
3. Set the validation fraction. The last rows are held out.
4. Click **Calibrate (steady rows)**. Only identifiable scales are fitted: indoor coil UA, compressor efficiency and displacement. The fit is bounded and regularised toward the reference.
5. The result is a new experiment profile. The published reference stays unchanged.

The app reports calibration and validation bias, MAE and RMSE separately, and the operating domain the evidence covers. **Load synthetic sample** generates a demonstration dataset from the simulator with altered UA and efficiency plus noise. It is labelled SYNTHETIC and is not a measurement.

On that sample, `etaIsPeak` is recovered well (scale 0.9625 vs. the true 0.96). Indoor air-side UA is poorly identifiable from steady capacity/power alone (0.9975 vs. the true 0.88). You need coil-surface or supply-air temperatures to pin it down. Transient calibration (time constants) is not automated.
