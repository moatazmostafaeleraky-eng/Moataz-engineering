"""Convert a triangle mesh into a validated OpenCascade solid.

The RoboDK container exposes tessellated visual geometry, not native BREP CAD.
This module reconstructs BREP solids from the available triangles only. It never
claims hidden design intent or manufacturing accuracy.
"""
from __future__ import annotations

from typing import Any

import numpy as np

from OCP.BRep import BRep_Builder
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_MakeSolid,
    BRepBuilderAPI_MakeVertex,
    BRepBuilderAPI_MakeWire,
    BRepBuilderAPI_Sewing,
)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.ShapeFix import ShapeFix_Solid
from OCP.TopAbs import TopAbs_SHELL
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Shape, TopoDS_Shell
from OCP.gp import gp_Pnt


def _triangle_faces(positions: list[float]):
    for i in range(0, len(positions), 9):
        points = [
            gp_Pnt(
                float(positions[i + j]) * 1000.0,
                float(positions[i + j + 1]) * 1000.0,
                float(positions[i + j + 2]) * 1000.0,
            )
            for j in (0, 3, 6)
        ]
        polygon = BRepBuilderAPI_MakePolygon()
        for point in points:
            polygon.Add(point)
        polygon.Close()
        if polygon.IsDone():
            face = BRepBuilderAPI_MakeFace(polygon.Wire()).Face()
            if not face.IsNull():
                yield face


def _manifold_repair(positions: list[float]) -> tuple[list[float], dict[str, Any]]:
    """Clean a mesh and convert it through manifold3d when topology permits."""
    import manifold3d
    import trimesh

    vertices = np.asarray(positions, dtype=np.float32).reshape(-1, 3)
    if not len(vertices) or len(vertices) % 3:
        return [], {"status": "invalid_triangle_vertex_array"}
    input_faces = np.arange(len(vertices), dtype=np.uint32).reshape(-1, 3)
    cleaned = trimesh.Trimesh(vertices=vertices, faces=input_faces, process=False)
    cleaned.process(validate=True)
    cleaned.update_faces(cleaned.unique_faces())
    cleaned.update_faces(cleaned.nondegenerate_faces())
    cleaned.remove_unreferenced_vertices()
    if not len(cleaned.faces):
        return [], {"status": "no_usable_triangles"}
    trimesh.repair.fix_normals(cleaned, multibody=True)

    candidates = [
        (np.asarray(cleaned.vertices, dtype=np.float32), np.asarray(cleaned.faces, dtype=np.uint32)),
    ]
    welded_vertices, inverse = np.unique(vertices, axis=0, return_inverse=True)
    candidates.append((welded_vertices.astype(np.float32), inverse[input_faces].astype(np.uint32)))
    for candidate_vertices, candidate_faces in candidates:
        try:
            solid = manifold3d.Manifold(manifold3d.Mesh(candidate_vertices, candidate_faces))
        except Exception:
            continue
        if solid.status() != manifold3d.Error.NoError or solid.num_tri() == 0 or solid.volume() <= 0:
            continue
        for tolerance_m in (0.00005, 0.0001, 0.0005, 0.001):
            simplified = solid.simplify(tolerance_m)
            if simplified.status() == manifold3d.Error.NoError and simplified.num_tri() and simplified.volume() > 0:
                solid = simplified
                used_tolerance_mm = tolerance_m * 1000.0
                break
        else:
            used_tolerance_mm = 0.0
        repaired = solid.to_mesh()
        flattened = repaired.vert_properties[repaired.tri_verts].reshape(-1).tolist()
        return flattened, {
            "status": "manifold3d_repaired",
            "simplify_tolerance_mm": used_tolerance_mm,
            "manifold_triangle_count": int(solid.num_tri()),
        }
    return [], {"status": "input_mesh_not_manifold"}


def _boundary_loops(faces: np.ndarray) -> tuple[int, list[list[int]]]:
    """Open boundary half-edges and the loops they form, ordered opposite to the faces."""
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    present = {tuple(e) for e in edges.tolist()}
    open_edges = [(a, b) for a, b in present if (b, a) not in present]
    following: dict[int, list[int]] = {}
    for a, b in open_edges:
        following.setdefault(b, []).append(a)
    used: set[tuple[int, int]] = set()
    loops = []
    for a, b in open_edges:
        if (b, a) in used:
            continue
        loop, current = [b], a
        used.add((b, a))
        while current != b:
            loop.append(current)
            choices = [x for x in following.get(current, []) if (current, x) not in used]
            if not choices or len(loop) > len(open_edges):
                loop = []
                break
            used.add((current, choices[0]))
            current = choices[0]
        if loop:
            loops.append(loop)
    return len(open_edges), loops


def _weld_and_close_repair(positions: list[float]) -> tuple[list[float], dict[str, Any]]:
    """Close visual meshes that are watertight except for split vertices, duplicates and pinholes.

    RoboDK stores each colour region as its own surface, so coincident vertices are
    duplicated and a few small gaps remain. Welding them, dropping duplicate faces
    and fan-closing small boundary loops keeps the original triangles; the implicit
    VTK reconstruction is only needed when this cannot produce a manifold.
    """
    import manifold3d

    points = np.asarray(positions, dtype=np.float64).reshape(-1, 3)
    if not len(points) or len(points) % 3:
        return [], {"status": "invalid_triangle_vertex_array"}
    for weld_m in (1e-7, 1e-6, 1e-5):
        keys = np.round(points / weld_m).astype(np.int64)
        _, first, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
        vertices = points[first]
        faces = inverse.reshape(-1, 3)
        faces = faces[(faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])]
        _, unique_rows = np.unique(np.sort(faces, axis=1), axis=0, return_index=True)
        faces = faces[np.sort(unique_rows)]
        if not len(faces):
            continue
        open_edges, loops = _boundary_loops(faces)
        # Only pinholes are closed; large openings need a real reconstruction.
        if open_edges > max(0.01 * len(faces), 12) or any(len(loop) > 200 for loop in loops):
            continue
        extra_vertices, extra_faces = [], []
        for loop in loops:
            centre = len(vertices) + len(extra_vertices)
            extra_vertices.append(vertices[loop].mean(axis=0))
            extra_faces.extend([loop[i], loop[(i + 1) % len(loop)], centre] for i in range(len(loop)))
        all_vertices = np.vstack([vertices, extra_vertices]) if extra_vertices else vertices
        all_faces = np.vstack([faces, extra_faces]) if extra_faces else faces
        solid = manifold3d.Manifold(manifold3d.Mesh(all_vertices.astype(np.float32), all_faces.astype(np.uint32)))
        if solid.status() != manifold3d.Error.NoError or solid.num_tri() == 0 or solid.volume() <= 0:
            continue
        simplified = solid.simplify(0.00005)
        if simplified.status() == manifold3d.Error.NoError and simplified.num_tri() and simplified.volume() > 0:
            solid = simplified
        mesh = solid.to_mesh()
        return mesh.vert_properties[mesh.tri_verts].reshape(-1).tolist(), {
            "status": "welded_and_closed",
            "weld_tolerance_mm": weld_m * 1000.0,
            "open_edges_before_closing": int(open_edges),
            "holes_closed": len(loops),
            "manifold_triangle_count": int(solid.num_tri()),
            "volume_m3": float(solid.volume()),
        }
    return [], {"status": "weld_and_close_not_manifold"}


def _vtk_surface_reconstruction(
    positions: list[float], *, sample_spacing_m: float = 0.003, neighborhood_size: int = 30
) -> tuple[list[float], dict[str, Any]]:
    """Reconstruct a watertight mesh from an open/non-manifold visual point cloud.

    VTK's oriented-point reconstruction produces a smooth implicit surface. A
    positive scalar pad is added around the reconstruction grid before contouring
    so the resulting surface closes rather than being clipped at the grid edge.
    The returned geometry is an approximation of the visual mesh, not native CAD.
    """
    import manifold3d
    import trimesh
    import vtk
    from vtk.util.numpy_support import numpy_to_vtk, numpy_to_vtkIdTypeArray, vtk_to_numpy

    source = np.asarray(positions, dtype=np.float32)
    if source.size < 12 or source.size % 9:
        raise ValueError("VTK fallback requires at least four complete triangles")
    source = source.reshape(-1, 3)
    if not np.isfinite(source).all():
        raise ValueError("VTK fallback input contains non-finite coordinates")
    source_min = source.min(axis=0)
    source_max = source.max(axis=0)
    unique_points = np.unique(source, axis=0)
    if len(unique_points) < 4:
        raise ValueError("VTK fallback requires at least four unique mesh points")

    _, inverse = np.unique(source, axis=0, return_inverse=True)
    triangle_indices = inverse.reshape(-1, 3).astype(np.int64)
    vtk_cells_data = np.empty((len(triangle_indices), 4), dtype=np.int64)
    vtk_cells_data[:, 0] = 3
    vtk_cells_data[:, 1:] = triangle_indices
    vtk_points = vtk.vtkPoints()
    vtk_points.SetData(numpy_to_vtk(unique_points, deep=True))
    vtk_cells = vtk.vtkCellArray()
    vtk_cells.SetCells(
        len(triangle_indices),
        numpy_to_vtkIdTypeArray(vtk_cells_data.reshape(-1), deep=True),
    )
    point_cloud = vtk.vtkPolyData()
    point_cloud.SetPoints(vtk_points)
    point_cloud.SetPolys(vtk_cells)

    reconstruction = vtk.vtkSurfaceReconstructionFilter()
    reconstruction.SetInputData(point_cloud)
    reconstruction.SetSampleSpacing(float(sample_spacing_m))
    reconstruction.SetNeighborhoodSize(int(neighborhood_size))
    reconstruction.Update()
    image = reconstruction.GetOutput()
    scalars = image.GetPointData().GetScalars()
    if scalars is None or image.GetNumberOfPoints() == 0:
        raise ValueError("VTK surface reconstruction returned an empty scalar field")
    values = vtk_to_numpy(scalars)
    cap_value = float(max(abs(float(values.min())), abs(float(values.max()))) + sample_spacing_m)
    extent = image.GetExtent()
    pad = vtk.vtkImageConstantPad()
    pad.SetInputConnection(reconstruction.GetOutputPort())
    pad.SetOutputWholeExtent(
        extent[0] - 8, extent[1] + 8,
        extent[2] - 8, extent[3] + 8,
        extent[4] - 8, extent[5] + 8,
    )
    pad.SetConstant(cap_value)
    pad.Update()

    contour = vtk.vtkFlyingEdges3D()
    contour.SetInputConnection(pad.GetOutputPort())
    contour.SetValue(0, 0.0)
    contour.ComputeNormalsOff()
    contour.Update()
    output = contour.GetOutput()
    if output.GetPoints() is None or output.GetNumberOfPolys() == 0:
        raise ValueError("VTK contouring returned no closed surface")
    vtk_vertices = vtk_to_numpy(output.GetPoints().GetData()).astype(np.float32, copy=True)
    cells = vtk_to_numpy(output.GetPolys().GetData())
    if cells.size % 4:
        raise ValueError("VTK contouring returned unexpected non-triangle cells")
    faces = cells.reshape(-1, 4)[:, 1:].astype(np.uint32, copy=True)
    mesh = trimesh.Trimesh(vertices=vtk_vertices, faces=faces, process=True)
    if not mesh.is_watertight or not len(mesh.faces) or not np.isfinite(mesh.volume):
        raise ValueError("VTK surface reconstruction did not produce a watertight mesh")
    if mesh.volume < 0:
        mesh.invert()
    if mesh.volume <= 0:
        raise ValueError("VTK surface reconstruction produced zero enclosed volume")

    margin = max(sample_spacing_m * 4.0, 0.0001)
    if np.any(mesh.bounds[0] < source_min - margin) or np.any(mesh.bounds[1] > source_max + margin):
        raise ValueError("VTK reconstruction exceeded the source mesh bounds by an unsafe margin")
    reconstructed = manifold3d.Manifold(
        manifold3d.Mesh(
            np.asarray(mesh.vertices, dtype=np.float32),
            np.asarray(mesh.faces, dtype=np.uint32),
        )
    )
    if reconstructed.status() != manifold3d.Error.NoError or reconstructed.num_tri() == 0 or reconstructed.volume() <= 0:
        raise ValueError(f"manifold3d rejected the VTK reconstruction: {reconstructed.status()}")
    source_triangle_count = int(reconstructed.num_tri())
    source_volume_m3 = float(reconstructed.volume())
    simplify_tolerance_m = 0.0005
    simplified = reconstructed.simplify(simplify_tolerance_m)
    if simplified.status() == manifold3d.Error.NoError and simplified.num_tri() and simplified.volume() > 0:
        reconstructed = simplified
    result = reconstructed.to_mesh()
    flattened = result.vert_properties[result.tri_verts].reshape(-1).tolist()
    return flattened, {
        "status": "vtk_surface_reconstructed",
        "reconstruction_sample_spacing_mm": float(sample_spacing_m * 1000.0),
        "reconstruction_neighborhood_size": int(neighborhood_size),
        "pre_simplification_triangle_count": source_triangle_count,
        "reconstruction_simplify_tolerance_mm": float(simplify_tolerance_m * 1000.0),
        "reconstructed_triangle_count": int(reconstructed.num_tri()),
        "reconstructed_volume_m3": float(reconstructed.volume()),
        "pre_simplification_volume_m3": source_volume_m3,
    }


def _count(shape: TopoDS_Shape, kind: int) -> int:
    explorer = TopExp_Explorer(shape, kind)
    total = 0
    while explorer.More():
        total += 1
        explorer.Next()
    return total


def _build_occt_solids(
    positions: list[float], *, tolerance_mm: float, part_name: str
) -> tuple[TopoDS_Shape, dict[str, int | float | str]]:
    faces = list(_triangle_faces(positions))
    if not faces:
        raise ValueError(f"{part_name}: reconstructed mesh contains no usable triangle faces")
    sewing = BRepBuilderAPI_Sewing(float(tolerance_mm), True, True, True, False)
    for face in faces:
        sewing.Add(face)
    sewing.Perform()
    sewn = sewing.SewedShape()
    shell_count = _count(sewn, TopAbs_SHELL)
    if shell_count < 1:
        raise ValueError(f"{part_name}: mesh did not produce a sewn shell")

    builder = BRep_Builder()
    solids = TopoDS_Compound()
    builder.MakeCompound(solids)
    solid_count = 0
    shell = TopExp_Explorer(sewn, TopAbs_SHELL)
    while shell.More():
        shell_shape = TopoDS.Shell_s(shell.Current())
        solid_builder = BRepBuilderAPI_MakeSolid(shell_shape)
        if not solid_builder.IsDone():
            raise ValueError(f"{part_name}: one of {shell_count} shells could not be made into a solid")
        fixer = ShapeFix_Solid()
        fixer.Init(solid_builder.Solid())
        fixer.Perform()
        fixed = fixer.Solid()
        if not BRepCheck_Analyzer(fixed).IsValid():
            raise ValueError(f"{part_name}: one reconstructed BREP solid failed OCCT validation")
        builder.Add(solids, fixed)
        solid_count += 1
        shell.Next()
    if solid_count != shell_count:
        raise ValueError(f"{part_name}: solid count does not match sewn shell count")
    return solids, {
        "triangle_count": len(faces),
        "shell_count": shell_count,
        "solid_count": solid_count,
        "sewing_tolerance_mm": float(tolerance_mm),
    }


def _build_occt_solids_from_topology(
    positions: list[float], *, part_name: str
) -> tuple[TopoDS_Shape, dict[str, int | float | str]]:
    """Build BREP solids directly from a closed indexed mesh, without sewing.

    A manifold3d result is already a closed 2-manifold whose triangles share
    exact vertices. Sewing re-derives that adjacency with a distance tolerance
    and can merge nearby features into invalid shells; sharing one OCCT edge per
    mesh edge keeps the topology the mesh already has.
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    points = np.asarray(positions, dtype=np.float64).reshape(-1, 3) * 1000.0
    unique, inverse = np.unique(points, axis=0, return_inverse=True)
    tris = inverse.reshape(-1, 3)
    tris = tris[(tris[:, 0] != tris[:, 1]) & (tris[:, 1] != tris[:, 2]) & (tris[:, 0] != tris[:, 2])]
    if not len(tris):
        raise ValueError(f"{part_name}: mesh contains no usable triangles")
    n = len(unique)
    rows = np.concatenate([tris[:, 0], tris[:, 1]])
    cols = np.concatenate([tris[:, 1], tris[:, 2]])
    _, labels = connected_components(coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n)), directed=False)
    face_labels = labels[tris[:, 0]]

    vertices = [BRepBuilderAPI_MakeVertex(gp_Pnt(*map(float, p))).Vertex() for p in unique]
    edges: dict[tuple[int, int], Any] = {}
    builder = BRep_Builder()
    solids = TopoDS_Compound()
    builder.MakeCompound(solids)
    solid_count = 0
    for label in np.unique(face_labels):
        shell = TopoDS_Shell()
        builder.MakeShell(shell)
        for tri in tris[face_labels == label]:
            wire_edges = []
            for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                key = (min(a, b), max(a, b))
                if key not in edges:
                    edges[key] = BRepBuilderAPI_MakeEdge(vertices[key[0]], vertices[key[1]]).Edge()
                edge = edges[key]
                wire_edges.append(edge if a < b else TopoDS.Edge_s(edge.Reversed()))
            wire = BRepBuilderAPI_MakeWire(*wire_edges)
            face = BRepBuilderAPI_MakeFace(wire.Wire(), True) if wire.IsDone() else None
            if face is None or not face.IsDone():
                raise ValueError(f"{part_name}: degenerate triangle prevents a closed shell")
            builder.Add(shell, face.Face())
        shell.Closed(True)
        solid_builder = BRepBuilderAPI_MakeSolid(shell)
        if not solid_builder.IsDone():
            raise ValueError(f"{part_name}: closed mesh body could not be made into a solid")
        fixer = ShapeFix_Solid()
        fixer.Init(solid_builder.Solid())
        fixer.Perform()
        fixed = fixer.Solid()
        if not BRepCheck_Analyzer(fixed).IsValid():
            raise ValueError(f"{part_name}: topology-built solid failed OCCT validation")
        builder.Add(solids, fixed)
        solid_count += 1
    return solids, {
        "triangle_count": int(len(tris)),
        "shell_count": solid_count,
        "solid_count": solid_count,
        "brep_method": "shared_edge_topology",
    }


def _closed_mesh_to_occt(positions: list[float], *, tolerance_mm: float, part_name: str):
    """Sew first (historic path); fall back to shared-edge topology when sewing is invalid."""
    try:
        shape, report = _build_occt_solids(positions, tolerance_mm=tolerance_mm, part_name=part_name)
        report["brep_method"] = "sewing"
        return shape, report
    except Exception as sewing_error:
        shape, report = _build_occt_solids_from_topology(positions, part_name=part_name)
        report["sewing_error"] = str(sewing_error)
        return shape, report


def _try_smooth(closed_positions: list[float], faceted, report: dict[str, Any], part_name: str, smooth_tol_mm: float):
    """Swap the faceted solid for reverse-engineered smooth surfaces when they validate."""
    from raedbots.cad.smooth_worker import smooth_in_subprocess

    points = np.asarray(closed_positions, dtype=np.float64).reshape(-1, 3) * 1000.0
    vertices, inverse = np.unique(points, axis=0, return_inverse=True)
    faces = inverse.reshape(-1, 3)
    shape, smooth_report = smooth_in_subprocess(vertices, faces, part_name=part_name, tol_mm=smooth_tol_mm)
    error = smooth_report.get("volume_error_pct")
    accepted = shape is not None and smooth_report.get("valid") and error is not None
    if smooth_tol_mm > 0.1 and not (accepted and abs(error) <= 1.0):
        # A patch that misses its area check at a loose fit tolerance falls back to
        # triangles; a tighter fit usually segments it cleanly, so keep the better run.
        retry_shape, retry_report = smooth_in_subprocess(vertices, faces, part_name=part_name, tol_mm=0.1)
        retry_error = retry_report.get("volume_error_pct")
        if retry_shape is not None and retry_report.get("valid") and retry_error is not None and (
            not accepted or abs(retry_error) < abs(error)
        ):
            shape, smooth_report, error, accepted = retry_shape, {**retry_report, "retried_from_tol_mm": smooth_tol_mm}, retry_error, True
    if accepted and abs(error) <= 2.0:
        report.update(surface="smooth", smooth=smooth_report)
        return shape, report
    if shape is not None:
        smooth_report = {**smooth_report, "status": "smooth_rejected_validation"}
    report.update(surface="faceted", smooth=smooth_report)
    return faceted, report


def mesh_to_solid(
    positions: list[float], *, tolerance_mm: float = 0.05, part_name: str = "part", smooth: bool = False,
    smooth_tol_mm: float = 0.25,
) -> tuple[TopoDS_Shape, dict[str, Any]]:
    """Return validated OCCT solids; reconstruct open visual meshes when needed.

    Coordinates arrive in metres from the RoboDK parser and are written in
    millimetres, matching the rest of the app's STEP convention. If ordinary
    manifold repair cannot close the input, an implicit VTK surface-reconstruction
    fallback is tried and its approximation settings are included in the report.
    With ``smooth`` the closed mesh is also reverse-engineered into planes,
    cylinders, cones, spheres and NURBS plates; the faceted solid is kept when
    that result does not validate.
    """
    def finish(closed, shape, report):
        report.setdefault("surface", "faceted")
        return _try_smooth(closed, shape, report, part_name, smooth_tol_mm) if smooth else (shape, report)

    flattened, repair_report = _manifold_repair(positions)
    if flattened:
        try:
            shape, brep_report = _closed_mesh_to_occt(
                flattened, tolerance_mm=tolerance_mm, part_name=part_name
            )
            brep_report.update(repair_report)
            brep_report["status"] = "manifold3d_repaired+validated_solid"
            return finish(flattened, shape, brep_report)
        except Exception as direct_error:
            repair_report = {**repair_report, "direct_brep_error": str(direct_error)}

    closed, close_report = _weld_and_close_repair(positions)
    if closed:
        try:
            shape, brep_report = _closed_mesh_to_occt(closed, tolerance_mm=tolerance_mm, part_name=part_name)
            brep_report.update(close_report)
            brep_report["input_mesh_repair_status"] = repair_report.get("status", "direct_brep_failed")
            brep_report["status"] = "welded_and_closed+validated_solid"
            return finish(closed, shape, brep_report)
        except Exception as close_error:
            repair_report = {**repair_report, "weld_and_close_error": str(close_error)}

    try:
        reconstructed_positions, reconstruction_report = _vtk_surface_reconstruction(positions)
        shape, brep_report = _closed_mesh_to_occt(
            reconstructed_positions, tolerance_mm=tolerance_mm, part_name=part_name
        )
    except Exception as exc:
        detail = repair_report.get("status", "manifold_repair_failed")
        raise ValueError(f"{part_name}: manifold repair failed ({detail}); VTK reconstruction failed: {exc}") from exc
    brep_report.update(reconstruction_report)
    brep_report["input_mesh_repair_status"] = repair_report.get("status", "direct_brep_failed")
    brep_report["status"] = "vtk_surface_reconstructed+validated_solid"
    return finish(reconstructed_positions, shape, brep_report)
