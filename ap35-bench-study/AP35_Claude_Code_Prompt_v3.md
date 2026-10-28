# Claude Code Build Prompt: Mitsubishi Electric AP35 Live Bench Study

Version 3: self-contained. Guided exploration, experiment replay, design comparison and model-based optimisation, plus the design direction, implementation decisions and pitfalls learned from a complete reference build.

## طريقة الاستخدام

1. افتح Claude Code جوه فولدر فاضي للمشروع.
2. ارفق الملف ده. ولو معاك ملف `AP35_BUILD_SPEC.md` ارفقه كمان، لأنه المواصفات التفصيلية: المعادلات والأرقام والجداول كاملة. لو الاتنين موجودين، Claude Code يمشي على الـ spec في أي تفصيلة رقمية.
3. ابعت رسالة البداية اللي تحت كما هي.

البرومبت ده مستقل ومش محتاج أي ملفات مرجعية تانية. كل توجيهات الشكل والتفاعل والجودة مكتوبة جواه في القسم 3 وفي الأقسام من 23 لـ 26.

الموديل المختار: Mitsubishi Electric MSZ-AP35VGK للوحدة الداخلية مع MUZ-AP35VG للوحدة الخارجية.

- قدرته الاسمية 3.5 كيلووات، حوالي 11,943 BTU/h، يعني قريب من فئة 12 ألف المقصودة بتكييف 1.5 حصان.
- الاختيار مرجع هندسي للمحاكاة، وليس ادعاءً بتوافر النسخة دي في السوق المصري.
- المواصفات المنشورة منفصلة عن الافتراضات، والتحكم داخل المحاكاة فقط.

### رسالة البداية (انسخها كما هي)

```
عاوزك تنفّذ التطبيق الموضّح في ملف AP35_Claude_Code_Prompt_v3.md بالكامل. اعتبره المرجع الأساسي لمتطلبات المشروع، ولو مرفق معاه AP35_BUILD_SPEC.md اعتبره المواصفات التفصيلية الملزمة (المعادلات والأرقام والجداول).
المشروع عبارة عن محاكاة هندسية تفاعلية لتكييف Mitsubishi Electric MSZ-AP35VGK + MUZ-AP35VG، بوحدتيه الداخلية والخارجية متصلتين وشغالتين مع بعض، مع محاكاة الأوضة وتوزيع الهوا ودورة التبريد والتحكم والأداء.
اشتغل باعتبارك فريق يجمع خبرة تصميم تكييفات الإنفرتر، الديناميكا الحرارية، الكنترول، وتطوير تطبيقات 3D.
طريقة التنفيذ المطلوبة:
1. اقرأ الملف كاملًا، وراجع مصادر الشركة الموجودة فيه قبل تثبيت مواصفات الجهاز وشكله ومكوناته.
2. اكتب خطة تنفيذ مختصرة، ثم ابدأ كتابة الكود وتشغيل المشروع مباشرة. المطلوب تطبيق فعلي، مش خطة أو صور واجهات فقط.
3. نفّذ على مراحل مترابطة، وكل مرحلة يكون فيها إصدار شغال. استمر للمراحل التالية من غير ما تستناني أقولك «كمل»، إلا لو فيه قرار أساسي لا يمكن حسمه من المتطلبات.
4. ابدأ بمحاكاة مترابطة سليمة للوحدتين، وبعدها أكمل التفاصيل البصرية، أدوات الفحص، المقارنات، تحسين التصميم، وإدخال نتائج المعمل.
5. كل تغيير في الكباس أو المراوح أو اللوفر لازم يظهر أثره في الحسابات والقراءات والعرض، حسب حدود النموذج المستخدم.
6. حافظ على نموذج الجهاز الأصلي، وخلي تعديلات التصميم والتجارب في نسخ منفصلة يمكن مقارنتها والرجوع عنها.
7. ميّز بوضوح بين بيانات الشركة، والافتراضات، والنتائج المحسوبة. متخترعش مواصفات أو دقة CFD أو وظائف وتنسبها للجهاز.
8. اهتم جدًا بجودة الشكل وسهولة الاستخدام حسب توجيهات التصميم في القسم 3 والقسم 24: الموديل ثلاثي الأبعاد هو مركز التجربة، والواجهة منظمة إلى استكشاف، هندسة، ومعمل تصميم.
9. شغّل التطبيق واختبر الوظائف والسيناريوهات والحسابات فعليًا (اختبارات أرقام + اختبار متصفح على الديسكتوب والموبايل)، وأصلح الأخطاء قبل التسليم. أي زر ظاهر لازم يكون شغال أو موضح سبب عدم إتاحته.
لو فيه أجزاء مش واضحة في المصادر، استعين بالـ patents والملفات الأون لاين الموثوقة، بس أي رقم مش منشور لموديل AP35 نفسه يتعلّم «assumed».
في النهاية سلّمني المشروع والكود كاملين، وطريقة تشغيل واضحة على Windows (ملف bat يشغّل بدبل كليك)، ولينك GitHub Pages لو متاح، ونتائج الاختبارات، وقائمة مختصرة بما تم تنفيذه وأي حدود أو نواقص فعلية.
ابدأ الآن بقراءة المرفقات وفحص بيئة المشروع، ثم التنفيذ.
```

---

# START OF BUILD PROMPT

You are a senior team in one person:

- inverter air-conditioning system engineer
- refrigeration-cycle modeller
- controls engineer
- airflow visualisation specialist
- expert Three.js and TypeScript developer

Build a complete, polished, interactive 3D engineering web application called **MITSUBISHI ELECTRIC AP35 | Live Inverter Bench Study**.

## Quality bar

The experience should feel like a **beautifully printed technical product study that happens to be alive**. Concretely, that means:

- Procedural machinery with real proportions.
- Moving components driven by the simulation.
- Cutaways and exploded assemblies with readable callouts.
- Live instruments and live orthographic drawings rendered from the same running model.
- One plain-language narration line that reacts to what the machine is doing.

All of this applies to a complete inverter split air conditioner, with its indoor and outdoor units operating together inside one coupled simulation. Sections 3 and 24 define the visual direction exactly.

The central experience is: **I change an operating condition or actuator, see the machine respond, see the air jet change, and understand the resulting temperatures, cooling capacity, electrical power, humidity, and control decisions.**

## Working rules

- Implement the working application.
- Do not stop at a proposal, screenshots, a decorative dashboard, or disconnected animations.
- Make sensible documented assumptions instead of asking for every missing dimension.
- Work in milestones, but complete all required functionality and report actual validation results.

## 1. Product definition and engineering honesty

Reconstruct a specific real product: **Mitsubishi Electric MSZ-AP35VGK indoor unit paired with MUZ-AP35VG outdoor unit**, using the official documents below.

- Pin the initial reconstruction to the E1 variant where the service manuals distinguish revisions.
- This is an independent engineering study, not a Mitsubishi Electric product or an official digital twin.

The requested "1.5 HP" class is interpreted as approximately 12,000 BTU/h.

- This model's actual nominal capacity is **3.5 kW, approximately 11,943 BTU/h**. Preserve that published rating; do not alter it to an exact 12,000.
- Do not convert market horsepower into electrical input or cooling power.

### Published baseline

Sources S1 to S3 below provide these anchors. Dimensions are deliberately normalised to **W × H × D**.

| Item | Baseline | Source |
|---|---|---|
| Indoor / outdoor | MSZ-AP35VGK / MUZ-AP35VG | S1 |
| Cooling nominal; published min–max | 3.5 kW; 1.1–3.8 kW | S1 |
| Heating nominal; published min–max | 4.0 kW; 1.6–4.3 kW (S3 p.6 states 1.3–4.6: keep both, record discrepancy D2) | S1, S3 |
| Nominal system electrical input, cooling / heating | 0.99 / 1.03 kW | S1 |
| Refrigerant | R32 | S1 |
| Supply | 220–240 V, single phase, 50 Hz | S1 |
| Indoor dimensions, W × H × D | 798 × 299 × 219 mm | S1, S2 p.11 |
| Outdoor dimensions, W × H × D | 800 × 550 × 285 mm; fan centre 302.5 mm from left, 280 mm above base | S1, S3 p.11 |
| Indoor / outdoor mass | 10.5 / 31 kg | S1 |
| Cooling indoor airflow, Silent → Low → Medium → High → Super High | 294 / 354 / 426 / 522 / 684 m³/h at 500 / 580 / 670 / 790 / 970 rpm | S2 p.6 |
| Heating indoor airflow, same speed order | 294 / 354 / 438 / **534** / 774 m³/h at 500 / 580 / 690 / 800 / 1070 rpm | S2 p.6 |
| Outdoor fan | cooling 470 rpm → 1038 m³/h, 940 → 2178; heating 640 → 1452, 780 → 1788, 900 → 2076 | S3 p.6 |
| Indoor cooling test air | 27 °C dry bulb / 19 °C wet bulb | S2 p.6 |
| Outdoor cooling test air | 35 °C dry bulb / 24 °C wet bulb | S2 p.6 |
| Heating test air | indoor 20 °C dry bulb; outdoor 7 °C dry bulb / 6 °C wet bulb | S2 p.6 |
| Compressor restart delay after switch-off | 3 minutes | S2 p.28 |

**Important correction (D1):** heating High is **534 m³/h**. The value 564 belongs to the AP42 column of the merged table; S1 gives 148 l/s, which is 533 m³/h. Verify merged columns visually; automatic PDF text extraction mixes the AP25/35/42 columns.

Published min–max capacities are conditional catalogue ratings, not globally valid saturation limits at every ambient condition.

- Nominal cooling COP from the baseline is about 3.54; nominal heating COP about 3.88. Calculate these from the model.
- Do not treat seasonal ratings as instantaneous efficiency.

Use an initial demonstration room of 4 × 4 × 2.8 m, at 30 °C and 55 % RH, outdoor 35 °C, setpoint 24 °C. These room values are assumptions, separate from the manufacturer rating conditions, and not a room-sizing recommendation.

### Official source pack and extraction rules

- **S1, product data:** https://library.mitsubishielectric.co.uk/pdf/download_full/3699
- **S2, indoor service manual OBH788-B:** https://library.mitsubishielectric.co.uk/pdf/download_full/3963
- **S3, outdoor service manual OBH789-A:** https://library.mitsubishielectric.co.uk/pdf/download_full/3965
- **S4, indoor exploded-parts catalogue OBB788-B:** https://library.mitsubishielectric.co.uk/pdf/download_full/3973
- **S5, outdoor exploded-parts catalogue OBB789-A:** https://library.mitsubishielectric.co.uk/pdf/download_full/3975
- **S6, indoor official document index:** https://library.mitsubishielectric.co.uk/pdf/model_search?model_query=MSZ-AP35VGK
- **S7, outdoor official document index:** https://library.mitsubishielectric.co.uk/pdf/model_search?model_query=MUZ-AP35VG&scope=all
- **S8, operation manual MSZ-AP25-50VG(K):** https://library.mitsubishielectric.co.uk/pdf/download_full/3970

If the network blocks these, ask the user once to allow `library.mitsubishielectric.co.uk` in the environment's network policy; do not guess values.

**Before coding the product-specific profile:**

- Inspect the relevant pages and diagrams. Extract:
  - fan rpm by mode and outdoor airflow
  - compressor identification and type (KVB073FYXMC, rolling-piston rotary)
  - refrigerant topology (S3 p.18) and operating ranges
  - controller functions (S2 §9, S3 §10–12, p.40–48)
  - the S3 p.29–30 cooling performance table (357 rows)
  - the S3 p.23 frequency-correction curves
  - coil data and part locations where available
- Use the reference photos and exploded drawings to reconstruct the geometry in code. The app need not distribute the source PDFs or their page images.

**Extraction rules:**

- Do not assign values from AP25, AP42, AP50, AP60/71, VGH, or VG2 to the AP35VG system.
- Record the source document, revision, page, exact variant and units for every extracted field.
- Resolve conflicts by matching the selected revision and measurement conditions. Preserve a discrepancy note instead of silently mixing values. Rounded brochure airflow in l/s may differ slightly from service data in m³/h.
- Use S3's published performance tables and correction curves where applicable, and preserve their rated-frequency and test-condition meanings.
- If you digitise a graph, label the values digitised/approximate and record the uncertainty.
- The rated compressor frequency is not printed. Read it where the S3 p.23 correction factor = 1.0: about 84 Hz cooling and 95 Hz heating (±2 Hz). Record this as discrepancy D3.
- A published frequency correction is not a complete proprietary compressor map.

**Two layers of operation:** read the operation manual (S8) to verify which remote features actually apply to this size and revision. Keep two clearly labelled layers:

- **Original product operation.**
- **Engineering experiment:** additional power caps, arbitrary fan rpm, geometry changes and unsupported swing functions belong here. POWERFUL and LONG exist only on AP60/71; do not offer them as original AP35 functions.
- Do not present invented features as original equipment.

The app should prominently say "Independent study based on published Mitsubishi Electric documentation; unverified internals and dynamics are modelled."

**Parameter registry:** create a central registry holding value, units, status, origin, valid range and explanation.

- Statuses: supplied, sourced, digitised, assumed, calibrated and computed.
- Keep a compact "Modelled" indicator and an expandable assumptions panel. Do not litter the main interface with research notes.

Any dimensions, maps, thresholds, thermal masses, time constants or control settings not verified in the exact source documents are explicitly modelled assumptions.

- Do not attribute them to Mitsubishi Electric.
- Manufacturer values take priority where verified.
- Undocumented control gains and logic remain a surrogate, not reverse-engineered firmware.

This is a local software simulator. Do not implement commands to actual mains-powered hardware or imply that its controller is deployable firmware.

## 2. Runtime and architecture

**Stack** (use exactly this, so results reproduce):

- TypeScript 5.6 strict
- Vite 5.4 with `base: './'` and `worker.format: 'es'`
- Three.js 0.170: OrbitControls, RoomEnvironment, RoundedBoxGeometry
- Vitest 2.1 for headless tests
- Playwright with Chromium for the browser smoke test
- No UI framework: use a tiny `h(tag, attrs, ...children)` DOM helper.

**Distribution:**

- Produce a static build in `dist/` that runs from a local HTTP server.
- No runtime API keys, paid APIs, CDN dependency, or network connection after install/build.
- Generate all default 3D geometry procedurally. Do not depend on downloaded CAD, Blender files, textures, photos, or sound recordings. Optional later CAD replacement must not block the complete default app.

**Layers:**

1. Typed configuration, units, property data and data provenance.
2. Pure numerical plant model: refrigerant cycle, coils, fans, motors, room, moisture.
3. Supervisory state machine, controllers, actuators, sensors, protections.
4. Approximate room-airflow field and temperature distribution.
5. Three.js scene, camera, annotations, animation and synthesised audio.
6. Controls, instruments, charts, scenario runner, import/export.

**One authoritative state.** Maintain one authoritative simulation state. Components, charts, particles, audio and explanations read that state. The renderer must never secretly calculate its own capacity, temperature or actuator speed.

**Time stepping:**

- Run physics on a **fixed 0.1 s step** in a **Web Worker** ("live" role), independent of display FPS.
- Compute expensive cycle state points every 5 steps; update the airflow field every 2 s.
- Demonstrate timestep convergence. Use bounded integration and explicit solver-failure handling.
- A second Web Worker ("batch" role) runs A/B, sweeps, robustness, counterfactuals, calibration and validation away from the render loop.

**Time controls:**

- Pause, single-step, reset, real time, 5×, 30× and 60× simulated time.
- Accelerate by running more fixed steps (bounded catch-up, at most 4000 steps per 16 ms tick); never by enlarging the step.
- A separate, clearly labelled "Mechanism slow view" may slow visual fan/compressor motion for inspection without changing the numerical rpm.

## 3. Visual direction and layout

**Character:** a premium Japanese technical product study, printed-plate quality.

**Palette:**

| Role | Colour |
|---|---|
| paper | #f4f1ea |
| paper-2 | #ece7dd |
| card | #fbfaf6 |
| ink | #23221f |
| ink-2 | #5b5850 |
| ink-3 | #8a857a |
| hairlines | #d9d2c4, #e7e1d5 |
| restrained Mitsubishi red accents | #c4161c |
| cool blue for indoor air and cold | #2f7fc1 |
| amber for outdoor heat rejection | #d9861c |
| copper pipework | #b87333 |
| OK | #2e7d4f |
| warning | #b7791f |

**Type:**

- Sans: Inter or Segoe UI.
- Mono with tabular numbers for every value: JetBrains Mono or Cascadia Mono.
- Arabic: Segoe UI or Noto Naskh Arabic.
- Panel titles in letter-spaced small caps.
- A large bold "AP**35**" title with "35" in red, plus a small exact-model subtitle: "MSZ-AP35VGK + MUZ-AP35VG · R32 · 3.5 kW (11,943 Btu/h)".

**Product look:**

- Match the actual white casing, front-panel proportions, outlet arrangement, outdoor grille, feet and service-panel placement from the official references.
- Include a small independent-study label; do not imply manufacturer endorsement.
- Avoid generic neon dashboards, huge empty cards, illegible tiny text and unnecessary decorative gauges.
- Every number carries its unit, and every badge carries its status colour: sourced green, assumed/modelled amber, calibrated blue, digitised violet, computed grey, conceptual red.

**Layout at a 1440 × 900 desktop viewport** (CSS grid: header 58 px; side columns 296 px; bottom strip 236 px):

- **Left:** remote-style user controls and a collapsible engineering console.
- **Centre:** the dominant interactive 3D scene, with both units visible and connected across a cutaway room wall.
- **Right:** compact live measurements and the current control/protection explanation.
- **Bottom:** tabs for trends, refrigeration circuit, P-h cycle, room slices and assembly drawings (plus the Engineer and Design Lab tabs in section 26).

Keep the primary workspace inside the viewport using tabs and intentional panel scrolling. The header must not clip at 1440 px; make its chip group scrollable and compact below 1560 px.

**Phones** (390 × 844):

- Vertical layout: header, then 3D stage at about 62 vh, right panel, left panel, bottom tabs.
- No horizontal page scroll.
- Readable controls; touch orbit that does not trap page scrolling.
- Keep the same horizontal field of view as the 1.6-aspect desktop framing, so both units stay in frame.
- Exploded-view labels become numbered tap targets.

**Language:**

- Provide English technical labels and an Egyptian-Arabic explanation toggle, using a string dictionary and proper right-to-left text panels. Example: "الكباس قلل سرعته لأن حرارة الأوضة قربت من الدرجة المطلوبة."
- Do not reverse the physical meaning of diagrams when switching language.

## 4. Build credible indoor and outdoor assemblies

### Indoor unit

Reconstruct the AP35 indoor casing and component layout using S2 and S4:

- front panel, upper return-air grille, two removable filters
- fin-and-tube coil (instanced fins), condensate tray with a visible water level
- drain hose
- cross-flow (line-flow) fan and motor RC0J30-CV
- control PCB, thermistors
- the actual horizontal vanes (upper and lower), vertical directing vanes, and stepper motors MV1–3
- Wi-Fi interface

Preserve the published envelope dimensions; mark inferred blade/fin detail as modelled.

Use a recognisable cross-flow blower, not an axial fan, inside the indoor unit. Show room air:

1. entering the upper return
2. passing through the filter and coil
3. travelling through the blower and scroll passage
4. leaving through the lower outlet

Room-flow particles must not pass through the solid casing.

### Outdoor unit

Model these parts:

- cabinet panels, L-shaped rear + left fin-and-tube coil, front axial propeller fan and grille
- fan motor RC0J50-NC
- compressor KVB073FYXMC on rubber mounts, with suction accumulator
- inverter PCB with heat sink and reactor
- 4-way valve 21S4 with R.V. coil
- LEV with strainer and capillary, mufflers
- stop valves (liquid 6.35, gas 9.52), insulated gas line, the smaller interconnect pipe, and the power/communication cable
- thermistors RT61, RT62, RT65 and RT68

Show outdoor air entering through the coil faces and leaving through the fan outlet. Indoor and outdoor air are separate circuits. This split AC recirculates indoor air; it does not supply fresh outdoor air.

Use the exact S3 circuit topology and its terminology (LEV). For cooling:

Compressor discharge → 4-way valve → outdoor condenser → LEV → indoor evaporator → 4-way valve / accumulator → compressor suction.

- Place each component consistently in the 3D assembly and the schematic.
- With the LEV in the outdoor unit, the small interconnect pipe carries low-pressure two-phase mixture in cooling. Do not label every small pipe as high-pressure liquid.
- In heating, reroute through the 4-way valve and reverse the coil roles.

Pipe colouring must follow the computed local temperature, with a legend (scale −5…95 °C). Do not attach fixed colours to a pipe regardless of mode. Label pressure, temperature, phase and direction on selection.

### Internal mechanism views

- The compressor internals are not published. Keep the correct external shell, and offer a separate, explicitly **conceptual** rolling-piston explainer (motor, shaft, eccentric roller, cylinder, vane, suction and discharge regions) whose speed is linked to the actual frequency.
- Do not label it an exact reconstruction.
- Animate both fan rotors, louvers, valve indicators and visible condensate in response to the state.
- Use a visual speed cap plus a motion-blur disc to avoid misleading reversed rotation from stroboscopic aliasing.

## 5. Required scene modes

Implement smooth eased transitions (1.2 s) between these modes, bound to keys 1–8:

1. **System:** room, wall, indoor unit, outdoor unit, interconnections. A well-composed three-quarter view.
2. **Indoor close-up:** coil, blower, outlet, louvers, condensate.
3. **Outdoor close-up:** compressor, fan, coil, inverter and valves.
4. **Cutaway / X-ray:** reveal internals with a clipping plane and ghosted casing (opacity about 0.14).
5. **Airflow:** visible indoor return/supply and outdoor intake/discharge, plume and streamlines.
6. **Refrigeration cycle:** live flow direction, cycle tracers along the pipes, state points, phases, heat and work arrows.
7. **Room comfort:** velocity/temperature slices, arrow field and probe locations.
8. **Exploded assembly:** meaningful part separation along per-part vectors, selectable labels and leader lines.

**Exploded behaviour:**

- Exploding pauses the simulation at a snapshot, remembers the previous running state, and offers an explicit "Reassemble and resume".
- Do not let parts appear disconnected while the physical simulation continues invisibly.
- Labels must never overlap: two stacked columns with leader lines on desktop, numbered dots on narrow screens.

**Orthographic drawings:** provide indoor front, indoor side, plan, outdoor front and **Section A-A through the indoor blower and louver**, all generated from the same geometry.

- Hide the walls when rendering and use a grey background, so white casings do not vanish.
- Dimension **only** published envelope dimensions. Assumed dimensions must be marked assumed; these are not manufacturing drawings.

## 6. User and engineering controls

### Normal remote controls

Replicate the model-specific remote functions from S2 §9 and S8. Never copy features that are listed only for a larger size. Required coverage:

- On/off with credible start and stop sequences. A big **Start cooling** button shows the restart-delay countdown instead of appearing broken.
- Mode: Cool, Heat, Dry, Fan, Auto.
- Setpoint: 16–31 °C in Cool, Dry and Auto; 10–31 °C in Heat; 0.5 °C steps. In Dry, the target comes from the initial room temperature.
- Indoor fan: Auto plus Silent, Low, Medium, High and Super High.
- VANE: Auto, 1–5, Swing. WIDE VANE: 1–5, Swing.
- ECONO COOL (cooling only: +2 K with swing), NIGHT MODE (outdoor noise limit), i-save (two presets; not in Dry or Auto), ON/OFF timer, weekly timer (at most 4 per day and 28 per week), operation lock (locks mode only).
- Experimental Eco power cap, Sleep schedule and Turbo exist **only** in the clearly labelled experiment layer.

Vertical direction is movement of the horizontal flap; horizontal direction is movement of the vertical vanes.

- Display numeric angles with a clear zero reference (degrees below horizontal), and actual versus requested positions.
- Respect mechanical limits, slew rates, parked positions and the 3 s startup positioning.

### Engineering console

Mark this panel "Simulator experiments, not original remote functions". Include a **Reset to published baseline** action. Any change to casing, louver geometry, fan design or component maps creates a modified experimental profile and preserves the published reference.

**Controls:**

- Compressor request in Hz (operational frequency treated as mechanical rev/s; electrical Hz = pole pairs × rev/s, with 2 pole pairs assumed and shown).
- Indoor and outdoor fan rpm, independently adjustable.
- LEV command in percent only. The pulse count is not documented, so do not show steps.
- Advanced controller parameters: Kp, Ki, thermo offsets, superheat target, ramp rate, swing period.
- Louver angle, swing limits, wide angle, outlet opening height and width, vane count (visual-only).
- Room dimensions, unit mounting position/height, envelope UA, thermal mass, outdoor temperature/RH, solar and internal load, occupancy, infiltration, door open, psychrometric-chamber mode.
- Faults: filter restriction, indoor and outdoor coil fouling, fan seized, sensor bias, sensor open/short, communication loss.
- Virtual sensors: lag, sample period, noise.
- Pipe length is geometry-only (no documented line-loss model). Say so.

**Override rules:**

- Explicitly separate **Automatic control** and **Manual engineering override**.
- A manual override still passes through the envelope limits and the protective arbitration.
- Every actuator shows its **requested**, **applied** and **actual** values, plus the reason for limiting.
- Do not confuse 50 Hz mains frequency with inverter output frequency.

## 7. Coupled refrigeration and performance model

Implement an honest reduced-order dynamic model. The objective is engineering cause and effect, not a claim of a fully validated digital twin.

### Property and map handling

**R32 tables:**

- Generate offline R32 tables with CoolProp (HEOS::R32).
- Align them to the saturation boundary (saturation-temperature level × superheat/subcooling offset), so interpolation never crosses the dome.
- Axes:
  - T_sat −50…75 °C in 0.5 K steps
  - pressure levels −50…72.5 °C in 2.5 K steps
  - superheat 0…160 K in 2.5 K steps
  - subcooling 0…50 K in 2 K steps
- Bundle the tables locally, together with the generator script, backend version, validity domain, and check points with interpolation tests.

Separate property accuracy from component-map accuracy: real fluid properties do not make an assumed compressor map or coil UA experimentally validated.

**Calibration first.** Calibrate against the selected model's published system performance table, frequency curves and rated points. Do not apply fan cube laws to compressor power. With no manufacturer map, use this bounded surrogate, documented and replaceable:

```
ṁ = ηv · ρ_suction · Vd · f
ηv  = clamp(0.3, 0.98, ηv0 − ηv,pr·(PR−1) − ηv,low·20/max(5,f))
ηis = clamp(0.2, 0.85, ηis,peak·(1 − ηis,pr·(PR/PRopt−1)²)·(1 − ηis,lo·lo²)),  lo = max(0,(fOpt−f)/fOpt)
ηmi = max(0.3, ηmotorInv·(1 − ηis,hi·hi²)),  hi = max(0,(f−fOpt)/fOpt)
W_shaft = ṁ·(h2s − h1)/ηis;  Q_shell = fShell·W_shaft;  P_elec = W_shaft/ηmi + P_inv,fixed
```

**LEV:**

```
ṁ = Cv · opening · √(2 ρ_liquid ΔP)
```

### Energy, phase and pressure consistency

**Refrigerant points:** 1 = compressor suction; 2 = compressor discharge; 3 = condenser outlet; 4 = LEV outlet. Explain whether pipe losses are included; here they are not, except a fixed suction pickup.

- Evaporator refrigerant heat absorption: Qevap = ṁ_ref × (h1e − h4)
- Compressor work into refrigerant: Wref = ṁ_ref × (h2 − h1)
- Condenser heat rejection: Qcond = ṁ_ref × (h2 − h3)
- Throttling: h4 = h3
- Core cycle balance: Qcond = Qevap + Qpickup + Wref

**System boundaries:**

- Distinguish refrigerant work, compressor electrical input, inverter losses, shell heat, fan electrical input, controls power and total appliance input. Account for each loss at its actual system boundary. Shell heat, inverter loss and outdoor fan power go to the outdoor air stream; the whole-system balance closes only if you do this.
- Define useful net room cooling (supply vs return enthalpy, including indoor fan heat) separately from gross evaporator capacity.
- P_total = P_compressor_electrical + P_indoor_fan + P_outdoor_fan + P_controls.
- COP_cooling = Q_net_cooling / P_total. Suppress instantaneous ratios when the output is under 150 W or the input under 80 W.
- Integrate energy in kWh of simulated time. EER displays its units. Do not call an instantaneous COP SEER or CSPF.

**Pressures and temperatures:**

- Use absolute pressures internally. Mark displayed pressure as bar(a) or bar(g).
- Differentiate air temperature, coil surface temperature, refrigerant saturation temperature, suction temperature and discharge temperature.
- Compute evaporator-outlet superheat and compressor-inlet superheat at their actual locations. Never assign quality outside the two-phase region.

**Superheat dynamics:**

- Superheat integrates the compressor-vs-LEV mass mismatch:
  ```
  dSH/dt = shK·(ṁ_comp − ṁ_LEV)/ṁ_ref,rated
  ```
- If the LEV passes more than the compressor draws at zero superheat, model **liquid carry-over** with an energy-consistent mixing model. Suction quality falls (floor 0.8), and the discharge temperature falls without a power spike.

**Solver failures:** retain a clearly marked last valid state, report the issue, and enter a controlled stop (SIM-N01) after repeated failures. Never display NaN, silently clamp a failed state, or extrapolate beyond a map without warning.

### Coils, air and moisture

**Coil model:**

- Bypass-factor / apparatus-dew-point coil at a uniform surface temperature. Solve the surface temperature so that air-side heat equals UA_ref·(Ts − T_sat): try a dry analytic guess first, then use Illinois false position for a wet coil.
- Use airflow-dependent air-side UA (exponent 0.6) and explicit lumped coil thermal inertia.
- Condensate leaves at the surface enthalpy. The water film is bookkept in film + tray; it can re-evaporate after shutdown and is never deleted.

**Air flows:**

- Use the humidity ratio for water mass balance and derive RH from it.
- Indoor and outdoor airflow come from the fan curve intersecting the resistance curve:
  ```
  dp = P0(1 − (Q/Qf)²)   against   k·r·Q²
  ```
  Indoor resistance is filter + coil + outlet (shares 0.25 / 0.45 / 0.30). The outlet term scales with (A_ref/A)², where **A_ref is computed from the unchanged default profile**, so geometry edits really change resistance.
- Reducing indoor fan speed lowers the leaving-air temperature while reducing capacity and approaching freeze protection.
- Increasing outdoor fan speed lowers the condensing temperature but consumes fan power.
- Changing compressor speed changes capacity and power nonlinearly.
- These outcomes must emerge from the coupled model, not from slider formulas.

## 8. Room model and visible air distribution

**Room balances:**

- Include room air, an effective wall/furniture thermal-mass node, envelope heat transfer, infiltration (+6 air changes per hour when the door is open), solar (split between air and mass), internal gains, and occupancy sensible and latent load.
- Define capacities and conductances with explicit units. Do not model all room cooling using the thermal capacity of air alone. Avoid counting latent heat twice.

**Spatial airflow:** an entraining buoyant jet traced from the actual outlet pose and vane angles, plus a 20 × 14 × 20 zonal grid. It must respond to:

- outlet effective free area and discharge velocity (m³/h → m³/s)
- horizontal and vertical vane angles and actual swing motion (20 s time-averaged field)
- potential core, spread, entrainment, velocity decay ∝ 1/s, and buoyant deflection
- walls, ceiling and floor (the jet becomes a wall jet) and furniture obstacles: desk, bed, wardrobe
- return-air capture and approximate recirculation, plus stratification

**Visuals:**

- Do not just rotate a cone of particles.
- Provide streamlines, vector arrows, a transparent plume envelope, temperature or velocity colour modes, and movable horizontal and vertical slices.
- Draw the jet centreline as a **faint dashed line** (35 % opacity). A solid line reads as a cable coming out of the unit.
- Throw is the distance to 0.25 m/s (a demonstration convention).

**Coupling to the room balance:** constrain spatial temperature deviations to the room-balance mean, and disclose this. Louver changes redistribute air; they do not create extra cooling energy.

**Probes and comfort:**

- Probes at the return, supply, desk, bed and occupied zone show local temperature and speed.
- Do not display PMV/PPD. Use defined draft and uniformity indicators instead.

**Honesty:**

- Label the view **Approximate airflow model, not CFD validation**.
- Refrigerant tracers are schematic.
- Indoor particles (about 1600) stay in the room air domain (z ≥ 0). Outdoor particles (about 700) stay outside the wall.

## 9. Controller and operating sequences

**States:** implement an explicit supervisory state machine with timestamped transitions: OFF, STANDBY, START_DELAY, STARTING, COOLING, HEATING, DRY, FAN_ONLY, MODULATING (entered and left with hysteresis), STOPPING, DEFROST, PROTECTION and FAULT.

**Documented sequences and limits:** in Original product operation, the documented S2/S3 sequences override the generic surrogate. Sourced values:

- 180 s restart lockout with a visible countdown
- outdoor fan on 5 s before and off 15 s after the compressor
- 4-way valve energised 5 s before start
- AUTO changeover after 15 min beyond 1 °C
- discharge 111 °C frequency drop / 116 °C stop / restart ≤ 100 °C
- indoor coil frost prevention ≤ 8 °C (frequency drop)
- HEAT high pressure 55 °C drop / 70 °C stop
- current about 10 A
- serial failure 180 s
- low discharge ≤ 50 °C for 20 min
- heat-sink 75–86 °C
- defrost finish 5 °C

Everything else is a labelled assumption.

**Include:**

- **Sensors:** filtered (lags of 20 s room, 8 s coil, 30 s ambient).
- **PI** on room error with conditional-integration anti-windup. Use units correctly: Hz/K and Hz/(K·s), with no stray ×60. Minimum frequency 13 Hz, maximum 98 Hz cooling / 115 Hz heating. Ramp limits +1 / −2 Hz/s.
- **Start sequence:** hold 30 Hz for 45 s, then modulate.
- **Limiters:** derating caps that fall while their condition holds and recover slowly. The tightest active cap is named as the limit reason.
- **Thermostat:** thermo-off/on with hysteresis, minimum on time, and cycling when the load is below minimum capacity.
- **LEV:** a surrogate PI on a discharge-temperature target (S3 10-3 says the LEV follows discharge temperature), with feed-forward on frequency.
- **Outdoor fan:** steps by frequency and condensing temperature in cooling, with low-ambient reduction; steps by frequency in heating.
- **Indoor fan:**
  - AUTO tied to demand.
  - "Very low" at thermo-off in cooling.
  - Heating cold-air prevention holds the fan until the coil is warm.
- **Priority:** fault shutdown > protection/derating > mode sequence > user request > normal optimisation.

**Narration:** show cause-and-effect narration as one sentence. Examples:

- "Room temperature is approaching target, compressor request is reducing."
- "Restricted filter reduced airflow; coil frost prevention is limiting the compressor."
- "Waiting for the 3-minute compressor restart delay: 42 s left."

**Modes:**

- **Cool:** continuous modulation.
- **Heat:** reverse the coil roles; warm-coil fan delay; frost and defrost.
- **Dry:** low airflow, frequency cap; target from the initial room temperature. Do not promise independent humidity control.
- **Fan:** compressor and outdoor fan off; residual coil effects decay.
- **Auto:** hysteresis and dwell.
- **Turbo, Eco, Sleep:** experiment layer only.

**Defrost (heating):**

- Frost accumulates on the outdoor coil below 0 °C and degrades its UA and airflow.
- Start after ≥ 30 min of heating with the coil ≤ −4 °C for 60 s (assumed).
- Sequence: stop 30 s → reverse cycle at 70 Hz with both fans off until the coil reaches 5 °C or 10 min → recover 30 s.
- Melting costs energy.
- Do **not** apply the 3-minute restart delay after a defrost; it is not a system stop.
- Never defrost in cooling.

**Protections and faults:**

- Cover the envelope boundary, discharge, coil freezing, fan failure, sensor failure, communication loss and current (estimated from power using the supply voltage and a declared power factor).
- Faults must have physical effects before and while protections respond.
- Use simulator codes (SIM-F01 indoor fan, SIM-F02 outdoor fan, SIM-S01 sensor, SIM-C01 communication, SIM-N01 numerical).
- **Reset rule:** the cause must be removed and power set to OFF then ON.
- Charge faults are not offered (there is no inventory model).

## 10. Instruments, charts and interaction

**Live values** (with appropriate precision and tooltips):

- room, return and supply air temperature and humidity
- outdoor entering and leaving air temperature
- compressor request, command and actual (rpm and electrical Hz)
- fan command and actual, and volume flow
- airflow and Δp with the resistance split
- louver angles and LEV opening
- net and gross capacity, sensible/latent split and SHR
- compressor, fan and total input; current; COP/EER; energy; condensate
- pressures (bar(a) or bar(g)), saturation, suction and discharge temperatures, superheat, subcooling, mass flows, coil surfaces, frost, core residual
- controller state, active limits, flags, fidelity badge, simulated time

Every row is clickable to the "why" inspector (section 16).

**Charts:**

- Trends: temperature and setpoint; compressor and fans; capacity, power and COP.
- RH and condensate; refrigerant states; event timeline.
- Use labelled axes with units, a right axis, selectable traces, and nice ticks with correct decimals. No fabricated random waveforms.

**P-h diagram:** a live diagram with log pressure, the saturation dome from the tables, and points 1–4 labelled with temperature and phase. In heating the coils swap roles; the cycle does not.

**Components:** click any component for its function, live state, source page, fidelity, linked controls, and upstream/downstream effects.

**Keyboard:** 1–8 select views, Space pauses or runs, Ctrl+K opens the assistant, ? shows the shortcuts. Shortcuts never intercept typing.

**Sound:** optional synthesised Web Audio (fan broadband noise, blade-pass tone, compressor hum tied to actual speed).

- Off by default; starts only after a user gesture; stops cleanly.
- Label it illustrative, not dB(A).

## 11. Scenarios, comparisons and exports

**Presets** (each with an English and an Arabic title):

1. Pull down a warm room to 24 °C (room 30 °C / 55 %, outdoor 35 °C).
2. Near-setpoint low-load modulation (room 24.6 °C, outdoor 29 °C, no sun).
3. Hot outdoor 46 °C with derating (the edge of the published data).
4. Same initial state: Low vs High indoor fan.
5. Same initial state: vane 1 vs vane 5 vs swing.
6. Restricted filter at Low fan (+400 % at 5 min).
7. Sudden 1.2 kW internal load plus open door.
8. Humid room (80 %) in Dry mode.
9. Heating warm-up from 14 °C.
10. Cold-weather defrost: outdoor 0 °C / 92 %, leaky room at 2 air changes per hour, run 105 min. Milder conditions never trigger a defrost.
11. Indoor fan fault, safe stop and recovery.
12. Room sensor failure and recovery.

**A/B runs:**

- Run A/B cases from identical initial states.
- Report delivered comfort, time-to-target (band held for a 300 s dwell), energy, energy to service, average useful capacity, peak input, condensate and occupied-zone uniformity.
- If a target is unreachable, report that instead of forcing success.

**Exports and imports:**

- Settings and scenarios: versioned JSON.
- Time series: CSV with units in the headers.
- Views: PNG.
- An HTML experiment report with assumptions and limitations.
- Import validates schema, ranges and units.

## 12. Performance and validation

**Performance:**

- Target 60 FPS on a recent laptop at 1440 × 900. Report the actual tested environment and the observed rate instead of guaranteeing an unmeasured one.
- Cap the device pixel ratio at 2, use instancing for fins and particles, and pause rendering when the tab is hidden.
- Keep the plant step around 0.02 ms. Fill the field only within about 2.2 jet widths of the jet samples.

**Acceptance criteria** (numeric targets in section 25):

1. Both units operate from one state, and all main controls cause model-driven changes.
2. **Rating points:**
   - Cooling: 3.50 kW / 0.99 kW within ±5 % from the **dynamic** simulator in chamber mode, at Super High and rated frequency.
   - Heating: 4.00 kW / 1.03 kW, checked separately.
   - Held-out published rows, with the residuals reported.
3. **Energy residuals:** steady core-cycle residual < 2 %, whole-system residual < 5 %, transient room balance with storage < 1 %.
4. Halving the timestep changes settled outputs by < 2 %; event timing differs by at most one step.
5. Enthalpy, airflow, condensate and capacity are consistent. Humidity ratio stays ≥ 0, RH ≤ 100 %, and water is never discarded.
6. Ramps, restart lockout, anti-windup and minimum-load cycling work.
7. Louver direction changes the jet and the distribution. At fixed resistance, direction alone gives identical capacity.
8. Lower airflow shifts the operating point.
9. Fan-only mode has no sustained refrigeration effect.
10. Heating and defrost use the correct direction, coil roles and fan behaviour.
11. The two air circuits stay separate.
12. Pause freezes all clocks; accelerated time integrates identically; reset is deterministic.
13. Overrides cannot bypass protections, and the reason is visible.
14. Faults generate timestamped events and reset only under the rule.
15. Import/export round-trips, and invalid data is rejected clearly.
16. Camera modes, cutaway, exploded view and reassembly work without losing settings or leaking GPU resources.
17. No console errors, broken controls, NaN values, unreadable mobile panels, or undisclosed unsupported outputs.

Do not satisfy tests by hard-coding readings or by asserting a value against the same constant used to display it. Print achieved values as `[result]` lines. Calibration agreement is not experimental proof.

## 13. Deliverables and completion

**Deliver:**

- Complete source with clear modules and a central equipment profile named `mitsubishi_ap35_reference`, plus editable experimental profiles.
- SOURCE_REGISTER.md and machine-readable provenance; PARAMETERS.md; FEATURE_MATRIX.md. The registers are generated from code by `npm run docs`, so they cannot drift.
- A runnable production build (`dist/` committed), a lockfile, a zero-dependency `serve.mjs`, `start-windows.bat` (double-click: checks Node, builds once if needed, opens the browser) and `dev-windows.bat`.
- Procedural assemblies, all scene modes, the coupled simulation, controllers, the room-air model, scenarios and exports.
- The property-table generator, calibration script (`npm run calibrate`) and validation CLI (`npm run validate`).
- Headless numerical tests (`npm test`), a Playwright smoke test (`npm run smoke`), and recorded results in docs/TEST_RESULTS.md.
- README (architecture, run commands for Windows and others, controls, assumptions), MODEL_NOTES.md, CALIBRATION_GUIDE.md, IMPLEMENTATION_CHECKLIST.md (working / tested / model-limited / not done).
- If GitHub access exists, publish `dist/` to a `gh-pages` branch, and tell the user the one Settings → Pages click needed for the public link.

**Implementation order:**

1. Coupled cooling loop and both units.
2. Detailed geometry and controls.
3. Airflow and room distribution.
4. Heating, Dry and protections.
5. Experiments, exports, performance and polish.

Keep every milestone runnable, and continue to completion.

**Before finishing:**

- Actually launch the app.
- Inspect it at 1440 × 900 and at 390 × 844 (look at the screenshots).
- Exercise the key scenarios, run all tests, and fix failures.
- List any environment blocker or remaining limitation.
- Do not claim unperformed tests, real CFD, manufacturer accuracy, certification, manufacturing-ready CAD or actual hardware control.

The finished result must let a mechanical engineer explore the whole inverter AC as one living system: **compressor + inverter + LEV + two heat exchangers + two fans + louvers + room + control logic**, with visible causal connections between changes and outcomes.

**References for implementation checks:**

- CoolProp: https://coolprop.org/coolprop/HighLevelAPI.html
- Mitsubishi Electric S1–S8 for all AP35-specific facts. Do not import another manufacturer's compressor limits or control behaviour.

## 14. Signature experience: one machine, three levels of depth

Use three workspaces that share the equipment configuration and the selected scenario:

- **Explore:** beautiful 3D operation, the remote, concise explanations and guided stories.
- **Engineer:** probes, sections, control traces, refrigerant and air measurements, fault experiments.
- **Design Lab:** modified designs, repeatable comparisons, sensitivity, optimisation and calibration.

Preserve state when switching workspaces. The published AP35 reference is immutable; experiments branch into named copies. Show a compact changed-parameters count in the header and allow reverting individual changes.

### 14.1 A memorable first minute

Start with a well-composed three-quarter view of both units connected through a section-cut wall, minimal controls, and a single **Start cooling** action. Then:

1. Open the actual vanes.
2. Animate the startup sequence.
3. Reveal the airflow.
4. Introduce three readings: room temperature, delivered capacity, electrical input.

Make any restart wait visible.

**Guided tour:** five chapters.

1. Room heat entering the indoor coil.
2. Refrigerant absorbing it.
3. The compressor raising pressure.
4. The outdoor coil rejecting heat.
5. The controller reducing demand near target.

Tour rules:

- Each chapter selects the component, positions the camera, highlights a path and gives one short explanation in English or Arabic.
- Use the current simulation state, or start a labelled demonstration scenario. Never edit the state to make a story look convincing.
- Pause, back, skip, reduced motion. Never auto-enable sound.

### 14.2 Follow the air, follow the refrigerant

Add **Follow room air**, **Follow refrigerant** and **Follow control command** tours.

- Show the relevant state at each station and how it changes across the component.
- Markers are schematic.
- The control view shows demand → actuator request → protection arbitration → actual response.

## 15. Virtual instruments and direct manipulation

### 15.1 A probe you can place anywhere supported

**Probe types:** air temperature, velocity, humidity, refrigerant state (snaps to points 1e/1/2/3/4) and electrical card.

- Probes are pinned to a trend chart.
- Probes inside solid furniture or outside the room are **rejected, with the reason**.
- **Ideal model value** and **virtual sensor reading** are shown side by side. The virtual reading has configurable lag, sample period, bias and seeded noise.

### 15.2 Handles on the actual geometry

In Design Lab, drag handles on the 3D outlet (opening height, mounting height).

- Show the value and its bounds.
- Update free area → resistance → airflow operating point → jet.
- Undo/redo, reset to the reference, and a translucent baseline overlay.

**Three classes of geometry:**

- supported empirical model
- imported validated performance
- **visual-only**: performance ranking disabled; vane count is in this class.

## 16. Explain every change and replay every experiment

### 16.1 "Why did this happen?" inspector

Changing measurements are clickable. The inspector shows:

- recent inputs and events
- the relevant equation or control rule
- the related components
- the active limit or fault

It runs over a configured dependency graph, which is support, not proof. **Test this explanation** runs a matched single-intervention counterfactual from the pre-change snapshot.

### 16.2 Time travel and reproducibility

**Recording:**

- Record inputs, timestamps, seed and version, plus complete snapshots every 60 s: thermal storage, humidity, integrators, timers, actuators, RNG state.
- Use a mulberry32 seeded RNG.

**Replay:**

- Timeline scrubbing, replay, **Branch experiment from here**.
- Rewind = load a checkpoint and re-simulate the recorded inputs.
- Export and import runs, and flag version mismatches.
- Verify that replay reproduces identical state and identical ordered events.

## 17. Comparison that an R&D engineer can use

### 17.1 Synchronised A/B workspace

Identical initial states, room/load schedules, simulation clock and **common plot and colour scales**. Show:

- difference metrics (B − A)
- a ghost line of B's jet in the 3D view
- presets for fan, fixed louver vs swing, outlet opening, unit location, controller tuning and filter restriction

### 17.2 A meaningful comfort scorecard

**Zones:**

| Zone | Draft threshold | Band |
|---|---|---|
| Desk | 0.25 m/s | ±1.0 K |
| Bed | 0.20 m/s | ±1.0 K |
| Even room coverage | 0.25 m/s | ±1.5 K |

**Metrics:**

- zone mean, minimum, maximum and spatial standard deviation
- draft fraction, time in band
- pull-down time, only when the band is held for 300 s
- overshoot, cycling count, energy to service

Do not present a single unexplained score.

## 18. Optimise the model, and show the tradeoffs

### 18.1 Automatic experiment runner

**Supported variables:** fan step, vane angle, setpoint, outlet height, mounting height, Kp, eco cap. Vane count is visual-only.

- **Sampling:** deterministic Latin hypercube, 8–64 runs.
- **Execution:** progress, cancellation, and a cache keyed by a hash of model + parameters + scenario + solver settings.
- **Sensitivity:** standardised regression coefficients for energy, time and uniformity, with the note "local vs global".
- **Cancellation:** the batch worker yields between runs; if a run does not return within 2 s, terminate and respawn the worker, and show "Job cancelled".

### 18.2 Pareto comparison, not a magic winner

Minimise energy-to-service and time-to-target under draft and target constraints.

- Feasible nondominated designs only; always include the reference.
- **Best among evaluated candidates under this model.**
- Show the number tested, bounds, constraints and failed runs.
- Compare energy only at equal service.
- No dB(A) optimisation without an acoustic model.

### 18.3 Robustness and confidence

Corner cases over declared ranges of envelope UA, coil UA and internal gains, called **scenario envelopes**. Show published, interpolated, calibrated, extrapolated and assumed dependencies through the fidelity indicator. No arbitrary confidence percentages.

## 19. Connect the simulator to real lab evidence

**Import:**

- CSV with `name [unit]` headers, a downloadable template, and metadata lines.
- Unit conversion: °F, K, kW, l/s, cfm, min.
- Missing cells stay missing; unknown columns are listed; gaps are warned.

**Calibration:**

- Fit only identifiable scales (indoor UA, compressor efficiency, displacement), bounded and regularised toward the reference.
- Independent calibration and validation subsets, each with bias, MAE, RMSE and residual plots, plus domain coverage.
- Results go into a named calibrated derivative profile.
- Bundle a sample generated by the simulator with altered parameters plus noise, labelled **SYNTHETIC**.

## 20. Diagnostics and an offline engineering assistant

### 20.1 Fault investigation

**Hidden training faults:** filter, indoor fouling, outdoor fouling, room sensor bias, coil sensor bias.

- Observations are compared against a clean-unit steady expectation using signature scoring.
- Ambiguity is shown, along with the next virtual measurement to take.
- A room-sensor bias is untestable without an independent probe, and says so.
- A reveal action ends the exercise.
- Present it as a training aid, not as repair instructions.

### 20.2 Assistant without an AI subscription

A local command palette (Ctrl+K) with a documented regex intent parser. Example phrases: "Compare Low and High indoor fan", "Why did compressor speed fall?", "Show where heat leaves the room", "Find the best tested louver/fan setting for the desk zone".

- Structured actions: selectComponent, setScenarioParameter, placeProbe, runComparison, runSweep, explainEvent, exportExperiment, loadScenario.
- All actions go through the same validation.
- Never disguise the parser as a language model.

## 21. Presentation-quality output

- Experiment story / HTML report.
- Presentation mode.
- Screenshot presets.
- A 12 s WebM recording of the 3D view if supported. Never claim MP4.

## 22. Delivery priorities and extension acceptance checks

**Milestones:**

1. Reliable AP35 reference and numerical checks.
2. Workspaces, tours, inspection.
3. Replay, geometry editing, comparison.
4. Sweeps, optimisation, evidence, diagnostics, export polish.

**Persistence:**

- Persist experiment state locally (`localStorage`, versioned).
- Recovery path: back up corrupt data and load the defaults.

**Additional checks:**

- The tour is interruptible.
- Probes cannot sample unsupported domains.
- Geometry edits update dependent quantities.
- The baseline is unchanged after experiments.
- Branches reproduce.
- A/B shares its conditions.
- Counterfactuals hold the other inputs constant.
- Optimisation reports only feasible designs and includes the baseline.
- Uncertainty reflects declared variation.
- Imported data preserves units and missingness.
- The assistant cannot bypass limits.
- Exports preserve evidence.

## 23. Proven implementation decisions (follow these to reproduce the reference build)

**Project layout:**

```
src/props (r32.ts + r32_tables.json, psychro.ts)
src/config (sources.ts, published.ts, registry.ts, calibration.json, profiles.ts)
src/model (types, components, steady, plant, airfield, validation)
src/control (controller)
src/sim (schema, engine, scenarios, runner, doe, evidence, diagnostics, explain, assistant, export, worker)
src/scene (kit, indoorUnit, outdoorUnit, airflowViz, app3d)
src/ui (styles.css, dom, bridge, state, i18n, charts, ph, circuit, features, app, tabs, extras)
tests/ (physics, control, experiments)
scripts/ (gen_r32_tables.py, calibrate.ts, validate.ts, gen_docs.ts)
e2e/smoke.mjs
```

**Steady solver:** nested bracketed false position.

- Inner loop: Te so that evaporator air-side heat equals refrigerant-side heat.
- Outer loop: Tc so that condenser air-side heat equals refrigerant-side heat.
- The dynamic plant must settle to the same point (Te and Tc within 0.15 K).

**Dynamic plant:** lumped coil nodes (metal + refrigerant hold-up), quasi-steady refrigerant flows within a step, and explicit Euler at 0.1 s.

**Calibration** (`scripts/calibrate.ts`): Nelder–Mead on sigmoid-bounded parameters, 10 000 evaluations, two restarts.

- **Fitted:** Vd, etaIsPeak, etaIsPr, prOpt, fOpt, etaIsHi, etaIsLo, etaVlow, etaVpr, pInvFixed, uaInAir, uaInRef, uaOutAir, uaOutRef.
- **Calibration set:** wet rows of the S3 table with indoor DB ∈ {24, 27, 30} and outdoor DB ∈ {21, 35, 46} (39 rows; sensible column weight 0.3); the cooling frequency curves; both rated points (weight 3); heating frequency points at 30, 50, 70 and 90 Hz; weak priors.
- **Held out:** every other row (283), and heating frequency points at 20, 40, 60, 80, 100 and 110 Hz.
- **Indoor fan power:** fitted from 19 W cooling / 26 W heating at Super High (970 / 1070 rpm). This is an inference (D4).
- **LEV Cv:** set so that the rated point needs 45 % opening.

**Reference values to reproduce** (within normal optimiser noise):

| Parameter | Value |
|---|---|
| Vd | 9.63 cm³/rev |
| etaIsPeak | 0.85 (at bound) |
| prOpt | 3.25 |
| fOpt | 60.5 Hz |
| pInvFixed | 23 W |
| uaInAir | 697 W/K |
| uaInRef | 598 W/K |
| uaOutAir | 639 W/K |
| uaOutRef | 2242 W/K |

The displacement is an *effective* parameter; do not present it as a measured swept volume.

**Controller gains:** kp 12 Hz/K, ki 0.025 Hz/(K·s); LEV kp 0.4 %/K, ki 0.006 %/(K·s); superheat integrator gain shK 1.5. Retune if the LEV limit-cycles.

**Room diorama:**

- The exterior wall is drawn as a section ending at a hatched cut face at x = mountX + 0.72 m.
- The outdoor unit sits beyond the cut on a wall bracket at (mountX + 1.75, 0.95, −0.34), rotated 180°.
- Piping runs from the rear right of the indoor unit.

**Camera presets** (eased, FOV 38°; ix = mountX):

| Mode | Camera position | Target |
|---|---|---|
| System | (ix−1.75, 2.95, 3.85) | (ix+0.8, 1.45, −0.25) |
| Airflow | (−2.2, 2.6, 5.6) | (ix+0.1, 1.0, 1.6) |
| Comfort | (−0.9, 5.6, 6.0) | (2.0, 0.4, 1.9) |

The other modes frame their subject at close range.

**Discrepancy register:**

| Id | Discrepancy |
|---|---|
| D1 | heating High airflow 534 not 564 |
| D2 | heating min–max S1 vs S3 |
| D3 | rated frequency digitised |
| D4 | fan power step inference |
| D5 | do not mix regional airflow listings |
| D6 | published SHF 0.88 at 684 m³/h implies leaving air above saturation; keep the physics (about 0.84) and report it |

## 24. Design and interaction quality checklist

Apply all of these. They replace any external visual reference.

1. **The 3D model is the hero.** It takes the centre and most of the pixels. Panels are quiet, thin-ruled and paper-coloured. No glowing dashboards.
2. **Real proportions first.** Build the casings from the published envelopes and the side-profile outline, with rounded edges, a clearcoat casing material, metallic copper and aluminium, and soft shadows. Use a hemisphere light plus one directional sun with a 2048² shadow map, and RoomEnvironment reflections.
3. **Everything that moves is driven by the simulation.** Fans, compressor rotor, vanes, 4-way slider, tray water level, frost layer, lamp brightness, pipe colours, tracers and particles. Nothing animates on a timer of its own.
4. **One narration line.** A single plain sentence that always says what the machine is doing and why, in English or Egyptian Arabic.
5. **Readable callouts.** Labels never overlap. Leader lines end in a red dot. Each label carries the part's fidelity (sourced, modelled or conceptual).
6. **Live drawings, not illustrations.** Orthographic views render the same running model, dimension only published sizes, and say "assumed" elsewhere.
7. **Instruments over gauges.** Use precise mono numbers, small charts with units and labelled axes, and a P-h diagram with the real dome. No decorative dials.
8. **Honest overlays always visible:** the independence notice, "Approximate airflow model, not CFD validation", the colour legend with its range, and the "Modelled" chip.
9. **Motion is calm.** Eased 1.2 s camera moves, reduced-motion support, a visual speed cap on rotors, and a faint dashed jet centreline.
10. **First minute is simple.** One Start button and three readings; depth is one click away (Engineer, Design Lab).
11. **Responsive for real.** Check screenshots at 1440 × 900 and 390 × 844. No clipped header chips, no overlapping overlays, no horizontal scroll.
12. **Every visible button works** or is disabled with a tooltip reason. The smoke test clicks every visible button in every tab.

## 25. Expected results (the reference build achieved these; match them)

| Check | Target |
|---|---|
| Dynamic rated cooling | 3.508 kW / 0.998 kW (+0.2 % / +0.8 %) |
| Dynamic rated heating | 3.990 kW / 1.027 kW (−0.3 % / −0.3 %) |
| Held-out table rows (n = 283) | capacity RMSE 2.1 % (max 4.8 %); input RMSE 3.1 % (max 10.7 %) |
| Heating frequency curve, held out | capacity-factor RMSE 0.041 |
| Capacity at fMaxCool / fMin | 3.81 kW (catalogue 3.8) / 0.90 kW (catalogue 1.1: report the −18 % gap) |
| Core residual / whole-system residual / room transient residual | 0 / −0.40 % / 0.70 % |
| dt 0.1 vs 0.05 s | < 0.003 % change |
| DRY 60 min | condensed = bookkept 0.416 kg |
| Restart after stop | 185 s |
| Low-load cycling | 5 thermo-offs, lockout honoured |
| Vane 5° / 35° / 65° at fixed resistance | identical capacity (2797 W) |
| Filter restriction | airflow 354 → 276 m³/h |
| Defrost scenario | 2 cycles, 0.91 kg melted |
| LEV forced 100 % | discharge 79 → 42 °C, suction quality 0.80, no power spike |
| Pull-down 30 min | occupied-zone mean 24.5 °C, std 0.48 K |
| Unit tests | 42 / 42 pass |
| Browser smoke test | 44 / 44 checks, zero console errors |

## 26. Pitfalls found in the reference build (avoid them)

1. **Time-weighted zone metrics frozen at the initial temperature.** The first field update measured elapsed time from −10⁹ s. Clamp the first interval to the field interval.
2. **Geometry edits had no effect.** The reference outlet area was computed from the edited profile. Compute it from the unchanged default profile.
3. **Defrost never triggered** in a mild scenario. Use 0 °C / 92 % RH, 2 air changes per hour, and a run long enough.
4. **Heating stalled after every defrost.** The 3-minute restart delay was applied. Exempt defrost recovery.
5. **Power spike when the LEV over-opens.** Use the energy-consistent liquid carry-over mixing model.
6. **PI too aggressive.** A stray ×60 unit conversion on the integral term. Keep Hz/(K·s).
7. **Whole-system balance −4.8 %.** Shell heat, inverter loss and suction pickup were missing from the outdoor leaving air. Include them, and the residual becomes −0.4 %.
8. **Calibration parameters pinned at their bounds, and wrong sensitivity to outdoor temperature.** Add etaVpr and pInvFixed, split the heating curve between calibration and validation, and down-weight the sensible column.
9. **The SHF 0.88 target is physically unreachable** at the published airflow. Document it (D6); do not force it.
10. **White-on-white drawings and walls blocking the view.** Render orthographic views with an allowlist of objects on a grey background.
11. **The diagnostics ranked "room sensor bias" first without evidence.** Mark it untestable without an independent probe.
12. **Batch cancel did nothing** until the job ended. Yield between runs and hard-stop after 2 s. Also handle the rejected promise with a toast.
13. **Mobile issues:** the indoor unit was cropped (keep the horizontal FOV), overlays overlapped, the exploded labels formed a wall, and header chips clipped at 1440 px.
14. **A solid blue jet centreline was read as a cable.** Draw it faint and dashed.
15. **The plant was too slow** (0.88 ms/step). Cache the cycle detail every 5 steps and limit field updates to cells near the jet. Target about 0.02 ms/step.
16. **Ask for network access to the Mitsubishi library early**; otherwise you end up guessing values.

# END OF BUILD PROMPT
