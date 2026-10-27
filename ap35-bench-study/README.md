# AP35 Live Inverter Bench Study

An interactive engineering simulator of the **Mitsubishi Electric MSZ-AP35VGK** indoor unit and **MUZ-AP35VG** outdoor unit (R32, 3.5 kW cooling / 4.0 kW heating) running as one coupled system: room, air distribution, refrigeration cycle, inverter control and performance, with a live 3D model.

> This is an independent study built from published Mitsubishi Electric documents. It is not a Mitsubishi Electric product. Internal geometry, control thresholds and dynamics that are not published are modelled and labelled as such everywhere in the app.

## Run it on Windows

You need **Node.js 18 or newer** ([nodejs.org](https://nodejs.org), LTS installer, default options).

1. Download or clone this repository and open the `ap35-bench-study` folder.
2. Double-click **`start-windows.bat`**.
   - The production build (`dist/`) is committed, so the first start needs no install. If `dist/` is missing, the script runs `npm install` and `npm run build` once.
   - The browser opens at <http://localhost:4173/>. Leave the black console window open while you use the app, and close it to stop.
3. Use Chrome or Edge (current versions). WebGL and module Web Workers are required. Opening `dist/index.html` directly from the file system will not work; the app needs the small local server.

From a terminal (PowerShell or cmd) the same steps are:

```bat
cd ap35-bench-study
node serve.mjs 4173 --open
```

For development with hot reload, double-click **`dev-windows.bat`** or run `npm install` then `npx vite --open` (port 5173).

If port 4173 is busy, run `node serve.mjs 4180 --open` instead.

## Other platforms

```bash
cd ap35-bench-study
npm install
npm run build && npm run serve      # http://localhost:4173/
# or: npm run dev                   # http://localhost:5173/
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Type-check (`tsc --noEmit`) and production build into `dist/` |
| `npm run serve` | Zero-dependency static server for `dist/` (`serve.mjs`) |
| `npm test` | 42 numerical, control and workflow tests (Vitest); prints `[result]` lines |
| `npm run validate` | Validation against the published data; writes `docs/validation_report.json` |
| `npm run calibrate` | Re-runs the calibration (`CAL_EVALS=10000` for a full run); writes `src/config/calibration.json` |
| `npm run smoke` | Browser smoke test with Playwright (see `e2e/smoke.mjs`) |
| `npm run docs` | Regenerates `SOURCE_REGISTER.md`, `FEATURE_MATRIX.md`, `PARAMETERS.md` from the code |

## Using the app

There are three workspaces in the header:

- **Explore**: the original product. Use the virtual remote (published functions only), scenario presets, guided tours and the eight 3D view modes (keys `1`–`8`): System, Indoor, Outdoor, Cutaway/X-ray, Airflow, Refrigeration cycle, Room comfort and Exploded. Click any part for the inspector, which shows the part's function, source and fidelity label.
- **Engineer**: refrigerant states, the P-h diagram, the refrigeration circuit, room slices and comfort zones, virtual probes, timeline and replay with branching, the "why" inspector, counterfactuals, fault injection and diagnostics, and validation.
- **Design Lab**: named experiment copies of the immutable reference profile, geometry and model edits with undo/redo and revert, A/B comparison from identical states, Latin-hypercube sweeps with a Pareto front, robustness envelopes and lab-CSV calibration.

Other controls:

- Header: pause/run (`Space`), single step, deterministic reset, speed 1×/5×/30×/60×, and the command assistant (`Ctrl+K`), e.g. "set fan to high" or "compare louver angles".
- Export: settings JSON, history CSV with units, an HTML report, and PNG screenshots.
- EN/عربي: Arabic narration and tours.

## Architecture

```
src/
  props/      R32 tables (CoolProp 8.0.0, offline) and psychrometrics (ASHRAE)
  config/     sources (S1–S8), published tables, parameter registry with status, profiles
  model/      components (fans, coils, compressor, LEV, cycle), steady solver, plant ODEs, airfield
  control/    supervisor state machine, PI frequency control, protections, defrost, LEV, vanes
  sim/        engine (fixed-step, snapshots, replay, probes), scenarios, runner, DOE, evidence,
              diagnostics, assistant, export, Web Worker (live + batch roles)
  scene/      Three.js indoor/outdoor units, part registry, room diorama, airflow visuals
  ui/         shell, remote, panels, charts, P-h, circuit, tabs, inspector, tours, i18n
tests/        physics, control, experiments (Vitest)
scripts/      calibrate.ts, validate.ts, gen_docs.ts, gen_r32_tables.py
e2e/          smoke.mjs (Playwright)
```

The live simulation runs in a Web Worker at a fixed 0.1 s step, so 60× means 600 steps per second of wall time. A second batch worker runs A/B comparisons, sweeps, robustness cases, calibration and validation without blocking the 3D view. Cancel stops a batch job between runs; if the job does not return within 2 s, the worker is terminated and restarted.

## Documentation

- [MODEL_NOTES.md](MODEL_NOTES.md): equations, boundaries, validity range, fidelity, and known gaps
- [CALIBRATION_GUIDE.md](CALIBRATION_GUIDE.md): what is fitted, to what, and how to recalibrate with lab data
- [SOURCE_REGISTER.md](SOURCE_REGISTER.md): official documents and discrepancies D1–D6
- [PARAMETERS.md](PARAMETERS.md): every parameter with value, unit, status and origin
- [FEATURE_MATRIX.md](FEATURE_MATRIX.md): original product functions vs. simulator experiments
- [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md): achieved numbers from the test suite and smoke test
- [IMPLEMENTATION_CHECKLIST.md](IMPLEMENTATION_CHECKLIST.md): working / tested / model-limited / not done
