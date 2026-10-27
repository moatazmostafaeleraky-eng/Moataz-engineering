# Test results

Run date: 2026-10-27.

Environment:

- Linux container, Node 22.22
- Vitest 2.1.8
- Chromium (Playwright) with software WebGL (SwiftShader), because no GPU is available in the container

Every number below is printed by the test suite as a `[result]` line (`npm test`) or by the smoke test (`npm run smoke`). No value is compared against the constant used to display it.

## Unit, numerical and workflow tests: 42/42 passed

```
tests/physics.test.ts      11 passed
tests/control.test.ts      19 passed
tests/experiments.test.ts  12 passed
Test Files 3 passed (3) · Tests 42 passed (42)
```

### Properties
| Check | Result | Limit |
|---|---|---|
| R32 enthalpy error vs. CoolProp check points (5 points, off-grid) | ≤ 0.005 % | 0.4 % |
| Tsat(psat(T)) round trip, −20…60 °C | < 0.02 K | 0.02 K |
| Quality only inside the dome | yes | — |

### Rating points, from the dynamic simulator (chamber mode, 25 min)
| Check | Model | Published | Error |
|---|---|---|---|
| Cooling capacity 27/19 °C, 35/24 °C | 3.508 kW | 3.50 kW | +0.2 % |
| Cooling input | 0.998 kW | 0.99 kW | +0.8 % |
| Heating capacity 20 °C, 7/6 °C | 3.990 kW | 4.00 kW | −0.3 % |
| Heating input | 1.027 kW | 1.03 kW | −0.3 % |
| Held-out table rows (n = 283): capacity RMSE / max | 2.14 % / 4.75 % | — | limit 5 % RMSE |
| Held-out table rows: input RMSE / max | 3.09 % / 10.74 % | — | limit 6 % RMSE |
| Heating frequency curve, held-out capacity factor RMSE | 0.041 | — | — |
| Capacity at fMaxCool | 3.81 kW | 3.8 kW (catalogue) | +0.2 % |
| Capacity at fMin | 0.90 kW | 1.1 kW (catalogue) | −18 % (known gap, limit 25 %) |

### Energy, moisture, consistency
| Check | Result |
|---|---|
| Core cycle residual at steady state | 0 |
| Whole-system residual (outdoor air rise vs. indoor removal + all electrical input) | −0.40 % |
| Dynamic steady state vs. steady solver, Te | 0.00 K |
| Room transient energy residual (storage included, 30 min) | 0.70 % |
| DRY 60 min: condensed / bookkept (tray + film) | 0.416 kg / 0.416 kg |
| DRY final room RH (from 80 %) | 71.7 % |
| dt 0.1 s vs 0.05 s: Troom / energy / Qnet difference | 0 / 0.003 % / 0.001 % |

### Control
| Check | Result |
|---|---|
| Max ramp up / down | 1.0 / 0.21 Hz/s (limits 1 / 2) |
| Restart after stop | 185.3 s (3-min delay plus the start sequence) |
| PI integrator after 1 h of saturation | 0 (anti-windup) |
| Frequency 4 min after demand reversal | 30 Hz |
| Low load: thermo-offs / compressor starts | 5 / 5, lockout honoured |
| Qnet at vane 5° / 35° / 65°, fixed resistance | 2797 / 2797 / 2797 W (direction alone adds no capacity) |
| Desk zone mean, horizontal vs. downward jet | 25.84 / 25.97 °C |
| Fan Low vs High: Te, Qnet, supply T | 5.74 vs 7.74 °C · 2568 vs 2767 W · 10.98 vs 13.54 °C |
| Airflow clean vs. restricted filter | 354 vs 276 m³/h |
| Fan-only Qnet after 1 min / 16 min | 73 W / −14 W (coil releases stored cold, then fan heat) |
| Heating: 4-way valve, Tc, Te, Tsup, Troom | reversed · 33.9 °C · 4.0 °C · 31.8 °C · 22.2 °C |
| Defrost: peak frost, cycles, melted, energy | 0.458 kg · 2 · 0.913 kg · 0.006 kWh |
| Outdoor particles max world z (wall face at −0.22) | −0.240 |
| Replay vs. original run, Troom difference | 0 (deterministic) |
| Override request 140 Hz | 30.1 Hz applied, "High pressure, COOL (assumed)" shown |
| Indoor fan fault | SIM-F01 latched; reset needs cause removed + power cycle |
| Discharge temperature before / after LEV forced to 100 % | 79.2 → 41.9 °C, suction quality 0.80 (flooding) |
| Outlet height 50 vs 90 mm: airflow / jet velocity | 491 vs 548 m³/h · 4.54 vs 2.82 m/s |

### Experiments, scenarios, tools
| Check | Result |
|---|---|
| All 12 scenario presets run (incl. heat-up, defrost, faults) | no solver rejections |
| Pull-down 30 min: occupied-zone mean / std / final room | 24.52 °C / 0.48 K / 23.70 °C |
| Fan A/B: time to target Low vs High | 323 s vs 263 s |
| Fan A/B: energy Low vs High | 0.303 vs 0.260 kWh |
| LHS deterministic; Pareto only feasible; baseline included | yes (7/7 feasible) |
| Visual-only geometry (vane count) never ranked feasible | yes |
| Diagnostics with restricted filter: ranking | filter, inFoul, roomBias (ambiguity reported) |
| Evidence on synthetic sample: fitted scales | etaIsPeak 0.9625 (true 0.96), uaInAir 0.9975 (true 0.88, poorly identifiable) |
| Evidence held-out (n = 5): capacity RMSE / power RMSE | 10.3 W / 4.6 W |
| Schema rejects invalid actions; settings import/export round-trip | yes |
| Reference profile immutable; experiment undo/redo/revert | yes |

## Browser smoke test: 44/44 passed

`npm run smoke` against the production build served by `serve.mjs`:

- The page loads with a WebGL canvas.
- Cooling starts and the readouts update.
- The render loop runs.
- All 8 view modes switch.
- Every tab in all three workspaces opens: Explore 7 tabs, Engineer 11, Lab 15. Every visible button in each tab and in the left panel is clicked, except long jobs, which are driven explicitly.
- An experiment copy is created.
- A/B compare produces its table.
- A running sweep is cancelled within about 3 s.
- Arabic narration renders.
- The phone layout (390 × 844) has no horizontal page overflow.
- There are no console errors or uncaught exceptions.

Frame rate in the container: 6.7 fps with **software** WebGL (SwiftShader, no GPU). This number says nothing about a real machine. On a normal laptop GPU the scene is light (procedural geometry, 2,300 particles), but I could not measure GPU fps from this environment.

Screenshots are written to `e2e/shots/` (desktop explore, exploded, lab, Arabic, phone).

## Bugs found and fixed during testing (this round)

1. **Time-averaged zone metrics over-weighted the first field update.** The first update's elapsed time was measured from −10⁹ s, so occupied-zone mean, std and draft in A/B and sweeps stayed at the initial room temperature (30.0 °C). It is fixed, and a regression test was added. The zone mean now follows the room: 24.5 °C after a 30-minute pull-down.
2. Batch cancel did not take effect until the job finished. The worker now yields between runs, and there is a hard stop after 2 s.
3. A cancelled job left an unhandled promise rejection. It is now reported to the user as "Job cancelled".
4. Header chips clipped at 1440 px.
5. On phones, the system view cropped the indoor unit (FOV now keeps the horizontal framing), the legend overlapped the stage buttons, and the exploded-view labels overlapped. Narrow screens now get numbered tap targets.
