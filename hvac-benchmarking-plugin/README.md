# HVAC Benchmarking Plugin + Offline-First Tablet PWA

A Flask/SQLite tool layer for the `hvac-benchmarking-skill`, plus an
installable, offline-first Progressive Web App (`pwa/`) that a technician
runs on a tablet during a physical teardown. The skill's operating rules --
evidence-state vocabulary, SI canonicalization, comparison formulas, and
review gates -- are the source of truth for both; the backend and the PWA
each implement them independently so the PWA keeps working with zero
network and reconciles with the server once it reconnects.

## Why offline-first

Teardown benchmarking happens on a bench, often without reliable Wi-Fi. The
PWA never blocks on the network for a workflow step:

- Every create/update writes to **IndexedDB** first and renders immediately.
- A **service worker** caches the entire app shell (HTML/CSS/JS/icons), so
  the UI loads and works with the device in airplane mode.
- A **sync queue** (also in IndexedDB) replays queued writes against the
  Flask API as soon as `navigator.onLine` and a `/health` check both agree
  the server is reachable -- automatically, with no user action required.
- Validation, BOM, KPI calculation, and product comparison are computed
  **locally** in the browser (mirroring the server's logic exactly), so
  those views work offline too, not just the capture forms.
- Photo evidence is captured straight into IndexedDB as a `Blob` and
  uploaded in the background once online.

## Run the server (and the PWA it serves)

```bash
cd hvac-benchmarking-plugin
pip install -r requirements.txt
python3 app.py
```

The API listens on `http://127.0.0.1:5050`. The PWA is served from the same
process at `http://127.0.0.1:5050/app/` (the bare `/` redirects there). Open
that URL on a tablet, or "Add to Home Screen" to install it. Set
`HVAC_BENCHMARK_DB` to use another SQLite file and `PORT` to change the port.

## Main tools (REST)

| Tool endpoint | Purpose |
|---|---|
| `POST /tools/create_benchmark_project` | Create project and register products |
| `POST /tools/update_project_status` | Advance a project through the review gates (forward-only) |
| `POST /tools/generate_teardown_checklist` | Generate indoor/outdoor/performance/cost tasks |
| `POST /tools/register_component` | Add an assembly/component record |
| `POST /tools/upload_evidence` | Link a photo, document, label, or test file by reference/URI |
| `POST /tools/upload_evidence_file` | Upload and store an actual evidence file (multipart) |
| `GET /evidence/<id>/file` | Retrieve a stored evidence file |
| `POST /tools/record_measurement` | Store raw and canonical values with provenance |
| `POST /tools/record_observation` | Store a reviewed-later observation (also used for confirmed comparisons) |
| `POST /tools/validate_project` | Detect missing evidence and incomplete records |
| `POST /tools/generate_bom` | Produce component-level BOM output |
| `POST /tools/compare_products` | Compare accepted measurements and calculate deltas |
| `POST /tools/calculate_kpis` | Calculate performance/mass, performance/power, and cost share |
| `POST /tools/generate_report` | Produce a draft report payload with validation and BOM |
| `GET /projects/<id>` | Retrieve project, components, and measurements |

`update_project_status` and `upload_evidence_file` are additions on top of
the original prototype, needed for the PWA's review-gate workflow and real
photo capture; everything else is unchanged.

## Safety behavior

The plugin keeps AI/observed records pending review, requires evidence IDs
for important measurements, blocks definitive comparison when accepted
values are missing or units differ, and returns limitations in report
output. The PWA adds: a controlled evidence-state/confidence vocabulary
(no free-text stand-ins), a mandatory engineer confirmation step before any
comparison delta is treated as more than a mechanical calculation, and
forward-only review gates. **This is a prototype and does not replace
laboratory, safety, regulatory, or engineer approval workflows.**

## The PWA (`pwa/`)

Plain HTML/CSS/JS, no build step, no framework, no CDN dependency -- so the
whole app shell can be precached by the service worker and still load with
no network at all.

```
pwa/
  index.html, manifest.webmanifest, sw.js
  css/styles.css              design tokens, light/dark, tablet layout
  icons/                      192/512 + maskable variants
  js/
    db.js                     IndexedDB wrapper (projects, checklists,
                               components, evidence, measurements,
                               observations, sync_queue, meta)
    sync.js                   drains the sync queue against the API
    api.js                    one function per backend route
    units.js                  SI canonicalization (skill's unit rules)
    checklist-library.js      mirrors generate_teardown_checklist()
    hvac-coverage.js          HVAC coverage name suggestions (datalist)
    ui.js                     controlled vocabularies + badges
    gates.js                  forward-only review-gate transitions
    evidence-capture.js       Blob capture + multipart sync payloads
    views/                    one module per workflow screen
```

Workflow screens: **Projects -> Checklist -> Components -> Evidence ->
Measurements -> Validation -> BOM -> Compare -> KPIs -> Report**, matching
the skill's standard workflow and review gates (`draft` ->
`capture_complete` -> `data_validated` -> `comparison_ready` ->
`decision_reviewed` -> `released`). Every AI/observed/inferred record is
flagged `pending review` in the UI until an engineer accepts it, and a
product comparison always requires an explicit engineer-confirmed
comparability state (`comparable` / `conditionally_comparable` /
`directional_only` / `not_comparable`) before it is treated as more than a
mechanical delta.

## Test

Backend (pytest):

```bash
pip install -r requirements.txt
pytest -q
```

End-to-end (Playwright, drives the real server + real browser):

```bash
cd e2e
npm install
npx playwright test
```

`tests/workflow.spec.js` drives the full teardown-to-release workflow
through the UI. `tests/offline-sync.spec.js` puts the browser context fully
offline, captures a new project from scratch against the cached app shell,
then reconnects and asserts the sync queue delivers it to the server
automatically.

## Quick request

```bash
curl -X POST http://127.0.0.1:5050/tools/create_benchmark_project \
  -H 'Content-Type: application/json' \
  -d '{"title":"Outdoor motor benchmark","scope":["outdoor","cost"],"products":[{"product_id":"OUR","owner_type":"our_product","model":"OUR-INV"},{"product_id":"COMP","owner_type":"competitor","model":"COMP-ELA"}]}'
```
