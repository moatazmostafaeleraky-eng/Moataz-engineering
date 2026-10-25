# RoboDK `.robot` to STEP solids

## Supported import

The reference importer supports the legacy RoboDK `.robot` container variant identified by its qCompress/zlib payload and validated header. It extracts triangle surfaces, converts source coordinates from millimetres to metres, and writes STEP in millimetres. Unsupported containers, curves, point clouds, malformed payload lengths, and non-finite coordinates are rejected instead of being guessed.

## Solid conversion paths

The preferred path welds and cleans triangle vertices with `trimesh`, repairs consistent meshes through `manifold3d`, and sews the resulting facets with OpenCascade. Each output BREP is checked with OCCT before it is written as STEP.

Some RoboDK visual links have open or non-manifold triangle surfaces. For those links only, the importer uses VTK's implicit surface reconstruction as a fallback, closes the reconstruction grid boundary, contours a watertight surface, and validates it with `manifold3d` and OpenCascade. The report records the chosen method, sample spacing, reconstructed triangle count, and volume. Links are skipped only when both conversion paths fail; a nonempty mesh is not labelled “empty” merely because its original topology is invalid.

The current fallback defaults to a 3 mm reconstruction sample spacing followed by a 0.5 mm `manifold3d` simplification tolerance to keep OpenCascade sewing tractable. These settings are surfaced per link in `solid_reports` and may be adjusted when a different detail/performance tradeoff is needed.

## Output and validation

The import creates individual `Reference_Parts/ROBDK-LINK-NN.step` files, a STEP compound assembly, `robot-import-report.json`, and an explanatory README. STL is intentionally not included. `solid_reports` records per-link triangle/shell/solid counts and repair method; `skipped_links` records any input link for which no validated solid could be produced.

The generated STEP is faceted, mesh-derived BREP geometry—not the manufacturer's native CAD, design-intent feature tree, or a verified manufacturing model. Surface reconstruction can smooth or close gaps in the visual mesh. It does not recover hidden motors, reducers, bearings, materials, tolerances, fasteners, or internal features. Review the BREP in a CAD application and verify fit, dimensions, and intended use before engineering or manufacturing decisions.

## Test and run

Install the project dependencies in a virtual environment:

```bash
python -m pip install -r requirements.txt
```

Run the application tests from the project root:

```bash
python -m pytest -q
```

The conversion entry point is `raedbots.robot_import.robodk_robot.export_reference_robot(source_path, output_dir)`. The legacy container reader is `parse_legacy_qcompress_robot(source_path)`. Only import robot files that you are authorized to inspect and redistribute; the source file and resulting meshes may be subject to RoboDK, supplier, or manufacturer licensing terms.
