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
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_MakeSolid,
    BRepBuilderAPI_Sewing,
)
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.ShapeFix import ShapeFix_Solid
from OCP.TopAbs import TopAbs_SHELL
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Shape
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


def mesh_to_solid(
    positions: list[float], *, tolerance_mm: float = 0.05, part_name: str = "part"
) -> tuple[TopoDS_Shape, dict[str, Any]]:
    """Return validated OCCT solids; reconstruct open visual meshes when needed.

    Coordinates arrive in metres from the RoboDK parser and are written in
    millimetres, matching the rest of the app's STEP convention. If ordinary
    manifold repair cannot close the input, an implicit VTK surface-reconstruction
    fallback is tried and its approximation settings are included in the report.
    """
    flattened, repair_report = _manifold_repair(positions)
    if flattened:
        try:
            shape, brep_report = _build_occt_solids(
                flattened, tolerance_mm=tolerance_mm, part_name=part_name
            )
            brep_report.update(repair_report)
            brep_report["status"] = "manifold3d_repaired+validated_solid"
            return shape, brep_report
        except Exception as direct_error:
            repair_report = {**repair_report, "direct_brep_error": str(direct_error)}

    try:
        reconstructed_positions, reconstruction_report = _vtk_surface_reconstruction(positions)
        shape, brep_report = _build_occt_solids(
            reconstructed_positions, tolerance_mm=tolerance_mm, part_name=part_name
        )
    except Exception as exc:
        detail = repair_report.get("status", "manifold_repair_failed")
        raise ValueError(f"{part_name}: manifold repair failed ({detail}); VTK reconstruction failed: {exc}") from exc
    brep_report.update(reconstruction_report)
    brep_report["input_mesh_repair_status"] = repair_report.get("status", "direct_brep_failed")
    brep_report["status"] = "vtk_surface_reconstructed+validated_solid"
    return shape, brep_report
