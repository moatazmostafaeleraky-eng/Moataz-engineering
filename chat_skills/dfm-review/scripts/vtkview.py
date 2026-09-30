"""Off-screen VTK renders for the toolmaker-style DFM deck (green part, colour maps, red call-out lines).

render() returns the PNG path and a projector that maps world points to image pixels, so the deck can
place red boxes and labels exactly on the features."""

from __future__ import annotations

import numpy as np
import trimesh
import vtk
from vtk.util.numpy_support import numpy_to_vtk, numpy_to_vtkIdTypeArray

GREEN = (0x3D, 0xBE, 0x3D)

# camera presets: (direction from the part centre to the eye, view-up)
CAMERAS = {
    "core_iso": ((-0.55, -0.72, -0.42), (0, 0, 1)),   # inside (B / core side)
    "cav_iso": ((0.55, 0.72, -0.42), (0, 0, 1)),      # outside (A / cavity side)
    "core_plan": ((0, -1, 0), (-1, 0, 0)),            # plan from the core side, Z horizontal
    "cav_plan": ((0, 1, 0), (1, 0, 0)),               # plan from the cavity side
    "side": ((1, 0, 0), (0, 1, 0)),                   # from +X, Z horizontal, Y (pull) up
    "end_top": ((0, 0, 1), (0, 1, 0)),                # from the top end
    "end_bottom": ((0, 0, -1), (0, 1, 0)),
    "top_end_iso": ((0.45, -0.55, 0.70), (0, 1, 0)),
    "bottom_end_iso": ((0.5, 0.45, -0.74), (0, 1, 0)),
}


def _polydata(mesh: trimesh.Trimesh, face_rgb) -> vtk.vtkPolyData:
    pts = vtk.vtkPoints()
    pts.SetData(numpy_to_vtk(np.ascontiguousarray(mesh.vertices, dtype=np.float64), deep=True))
    f = np.hstack([np.full((len(mesh.faces), 1), 3), mesh.faces]).astype(np.int64).ravel()
    cells = vtk.vtkCellArray()
    cells.SetCells(len(mesh.faces), numpy_to_vtkIdTypeArray(f, deep=True))
    pd = vtk.vtkPolyData()
    pd.SetPoints(pts)
    pd.SetPolys(cells)
    col = np.asarray(face_rgb)
    if col.ndim == 1:
        col = np.tile(col, (len(mesh.faces), 1))
    if col.max() <= 1.0:
        col = col * 255
    arr = numpy_to_vtk(np.ascontiguousarray(col[:, :3].astype(np.uint8)), deep=True)
    arr.SetName("rgb")
    pd.GetCellData().SetScalars(arr)
    return pd


def _lines_actor(segs, rgb=(1, 0, 0), width=3.0):
    pts = vtk.vtkPoints()
    lines = vtk.vtkCellArray()
    for a, b in segs:
        i = pts.InsertNextPoint(*a)
        j = pts.InsertNextPoint(*b)
        ln = vtk.vtkLine()
        ln.GetPointIds().SetId(0, i)
        ln.GetPointIds().SetId(1, j)
        lines.InsertNextCell(ln)
    pd = vtk.vtkPolyData()
    pd.SetPoints(pts)
    pd.SetLines(lines)
    mp = vtk.vtkPolyDataMapper()
    mp.SetInputData(pd)
    mp.SetResolveCoincidentTopologyToPolygonOffset()
    a = vtk.vtkActor()
    a.SetMapper(mp)
    a.GetProperty().SetColor(*rgb)
    a.GetProperty().SetLineWidth(width)
    a.GetProperty().SetLighting(False)
    return a


def render(mesh, face_rgb, out, camera="core_iso", size=(1400, 1000), lines=None, line_rgb=(1, 0, 0),
           line_w=3.0, edges=True, extra=None, zoom=1.0, focus=None, opacity=1.0, parallel_scale=None):
    """Render `mesh` with per-face colours to `out` (PNG). Returns (out, project(points)->pixels)."""
    pd = _polydata(mesh, face_rgb)
    mp = vtk.vtkPolyDataMapper()
    mp.SetInputData(pd)
    mp.SetColorModeToDirectScalars()
    mp.SetScalarModeToUseCellData()
    mp.SetResolveCoincidentTopologyToPolygonOffset()
    actor = vtk.vtkActor()
    actor.SetMapper(mp)
    pr = actor.GetProperty()
    pr.SetAmbient(0.28)
    pr.SetDiffuse(0.78)
    pr.SetSpecular(0.08)
    pr.SetOpacity(opacity)
    ren = vtk.vtkRenderer()
    ren.AddActor(actor)
    ren.SetBackground(1, 1, 1)
    if edges:  # crisp CAD-like outline: feature edges at 35 deg
        fe = vtk.vtkFeatureEdges()
        fe.SetInputData(pd)
        fe.BoundaryEdgesOn()
        fe.FeatureEdgesOn()
        fe.SetFeatureAngle(35)
        fe.ManifoldEdgesOff()
        fe.NonManifoldEdgesOff()
        fe.ColoringOff()
        em = vtk.vtkPolyDataMapper()
        em.SetInputConnection(fe.GetOutputPort())
        em.SetResolveCoincidentTopologyToPolygonOffset()
        ea = vtk.vtkActor()
        ea.SetMapper(em)
        ea.GetProperty().SetColor(0.08, 0.28, 0.08)
        ea.GetProperty().SetLineWidth(0.8)
        ea.GetProperty().SetOpacity(0.55 * opacity)
        ren.AddActor(ea)
    if lines is not None and len(lines):
        ren.AddActor(_lines_actor(lines, line_rgb, line_w))
    for a in extra or []:
        ren.AddActor(a)
    win = vtk.vtkRenderWindow()
    win.SetOffScreenRendering(1)
    win.AddRenderer(ren)
    win.SetSize(*size)
    d, up = CAMERAS[camera] if isinstance(camera, str) else camera
    c = np.asarray(focus if focus is not None else mesh.bounds.mean(0), float)
    cam = ren.GetActiveCamera()
    cam.SetFocalPoint(*c)
    cam.SetPosition(*(c + 500 * np.asarray(d, float) / np.linalg.norm(d)))
    cam.SetViewUp(*up)
    cam.ParallelProjectionOn()
    ren.ResetCamera()
    if focus is not None:
        cam.SetFocalPoint(*c)
        cam.SetPosition(*(c + 500 * np.asarray(d, float) / np.linalg.norm(d)))
    if parallel_scale:
        cam.SetParallelScale(parallel_scale)
    else:
        cam.Zoom(zoom)
    ren.ResetCameraClippingRange()
    win.Render()
    w2i = vtk.vtkWindowToImageFilter()
    w2i.SetInput(win)
    w2i.Update()
    wr = vtk.vtkPNGWriter()
    wr.SetFileName(str(out))
    wr.SetInputConnection(w2i.GetOutputPort())
    wr.Write()
    W, H = size
    M = cam.GetCompositeProjectionTransformMatrix(W / H, -1, 1)
    Mn = np.array([[M.GetElement(i, j) for j in range(4)] for i in range(4)])

    def project(points):
        """World -> image pixels (x right, y down), from the camera used for this render."""
        P = np.c_[np.atleast_2d(np.asarray(points, float)), np.ones(len(np.atleast_2d(points)))] @ Mn.T
        ndc = P[:, :3] / P[:, 3:4]
        return np.c_[(ndc[:, 0] + 1) / 2 * W, (1 - (ndc[:, 1] + 1) / 2) * H]

    return str(out), project


def sphere_actor(center, r, rgb=(1, 0, 0)):
    s = vtk.vtkSphereSource()
    s.SetCenter(*center)
    s.SetRadius(r)
    s.SetThetaResolution(24)
    s.SetPhiResolution(16)
    m = vtk.vtkPolyDataMapper()
    m.SetInputConnection(s.GetOutputPort())
    a = vtk.vtkActor()
    a.SetMapper(m)
    a.GetProperty().SetColor(*rgb)
    return a


def box_actor(lo, hi, rgb=(0.72, 0.35, 0.85), opacity=0.55):
    c = vtk.vtkCubeSource()
    c.SetBounds(lo[0], hi[0], lo[1], hi[1], lo[2], hi[2])
    m = vtk.vtkPolyDataMapper()
    m.SetInputConnection(c.GetOutputPort())
    a = vtk.vtkActor()
    a.SetMapper(m)
    a.GetProperty().SetColor(*rgb)
    a.GetProperty().SetOpacity(opacity)
    return a


def mesh_actor(mesh, rgb, opacity=1.0):
    pd = _polydata(mesh, rgb)
    m = vtk.vtkPolyDataMapper()
    m.SetInputData(pd)
    m.SetColorModeToDirectScalars()
    m.SetScalarModeToUseCellData()
    a = vtk.vtkActor()
    a.SetMapper(m)
    a.GetProperty().SetOpacity(opacity)
    return a
