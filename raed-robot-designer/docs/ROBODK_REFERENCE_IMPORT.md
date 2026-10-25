# RoboDK `.robot` reference import

## Purpose

The application can accept an authorized RoboDK `.robot` asset for **detailed competitor benchmarking**, extract the available robot metadata and triangle meshes, and produce a review package containing:

- One validated BREP STEP solid per available robot link.
- A reference assembly STEP containing the reconstructed solids.
- `robot-import-report.json` with source SHA-256, robot name, payload/reach metadata, modified DH values, joint limits, link count, and provenance status.
- Per-link surface count, triangle count, vertex count, bounding box, envelope dimensions, surface area estimate, and material colors.
- Whole-model envelope dimensions and metadata warnings when the `.robot` header does not verify payload, reach, or mass.

## Important boundary

A RoboDK `.robot` file is treated as a robot model/reference package. The importer sews each link's available triangle mesh with OpenCascade and writes a STEP BREP solid only when the mesh forms one valid closed shell. This is a mesh-derived solid, not the manufacturer's native BREP CAD; motor/reducer/bearing details, material grades, fits, tolerances, and production drawings are not inferred. Open or invalid meshes are rejected rather than exported as misleading surface compounds. STL files are not included in the solid-only package.

Unknown `.robot` variants are rejected instead of being parsed heuristically. The current safe parser supports the recognized legacy qCompress/zlib triangle-mesh container used by the existing UP6 reference workflow.

## API

```text
POST /api/reference-import/robodk-robot
```

Multipart field: `file` with a `.robot` file. The endpoint returns `ROBDK-REFERENCE-IMPORT.zip`.

## Rights and provenance

Use only files the organization is authorized to inspect and redistribute. Keep the original source hash and source URL/filename in the report. Do not present competitor reference meshes as Raed Bots manufacturing CAD, and do not infer or claim hidden internal details that are absent from the source.
