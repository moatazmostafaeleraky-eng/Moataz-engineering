# Solid robot viewer

The English design studio now uses local WebGL 2 geometry instead of canvas
line segments. Drag to orbit, scroll to zoom, right-drag to pan, and use Reset
view to frame the model. No CDN connection is required at runtime.

## Yaskawa Motoman UP6 reference

The initial view is the actual mesh from the user-requested
[RoboDK UP6 library entry](https://robodk.com/robot/Yaskawa-Motoman/UP6).
It contains 2,148 triangles in seven independently transformed links, including
the original housing, motor covers, base and lettering. The six sliders use
the reference's modified DH frames. Home pose restores all six axes to zero,
with the flange at [0.790, 0, 1.055] metres and facing downwards.
Motion range shows 240 deterministic geometric flange samples.

Source: https://cdn.robodk.com/downloads-library/library-robots/Yaskawa-Motoman-UP6.robot

`src/raedbots/web/models/up6.json` records source URL, SHA-256, units, mesh
positions, materials, modified DH data and joint bounds. The offline conversion
script is `tools/import_up6.py`. It accepts only this legacy UP6 structure and
checks dimensions, finite coordinates, block counts and complete consumption
of the decompressed file. It does not execute source-file content. Original
mesh attribution remains with its source; the Three.js MIT license does not
apply to the RoboDK model.

Reference articulation is geometric, not a calibrated controller simulation:
controller sign conventions, axis coupling, dynamics, self-collisions and
manufacturing interfaces have not been validated. Its displayed mass, payload
and reach identify the reference, not the designed robot.

## Current design

The Robot model selector switches to the saved design's server FK, displayed
as solid industrial housings, servo covers, base bolts, flange and a tool
envelope. Tool placement follows the saved flange/TCP rather than unsaved form
values. Workcell boxes, task labels and paths remain available in this mode.

Reference sliders never save revisions or change calculations. Capturing a
design TCP is enabled only in Current design mode. The UI identifies reference
scope and labels calculation results as belonging to the design. Existing
STEP/STL concept exports are unchanged; neither the reference mesh nor these
new cosmetic shells are substituted for engineering export geometry.

## Dependencies and verification

- Three.js 0.180.0, OrbitControls and BufferGeometryUtils are vendored locally
  under `web/vendor`, with the upstream MIT LICENSE.
- `tests/viewer-smoke.cjs` exercises loading, all six sliders, home reset,
  range points, model switching, TCP capture, obstacles and 768/390 px layouts.
  It checks browser errors, failed resource requests and horizontal overflow.
- Set `RAED_PLAYWRIGHT` to a Playwright module path and optionally `RAED_URL`
  and `RAED_VIEWER_OUTPUT`; run `node tests/viewer-smoke.cjs` with the server
  running. It does not save or calculate projects.
- WebGL 2 errors are reported in the canvas area; the rest of the design app
  remains usable. Viewer geometry is disposed when scenes are replaced.

## Neutral application labels

The application uses generic English robot labels and hides the 196 triangles
that form the arm lettering on both sides. Source identification is retained in
this technical documentation and asset metadata. The displayed robot has 1,952
triangles; its articulation and physical surfaces are unchanged.
