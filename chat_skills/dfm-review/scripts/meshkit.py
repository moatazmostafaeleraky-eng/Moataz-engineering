"""Mesh-level mould analysis helpers used by run_dfm.py.

All functions work in the part frame (pull direction = +/-Y, +Y = cavity / A side).
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import build123d as bd
import numpy as np
import trimesh
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

PULL = np.array([0.0, 1.0, 0.0])


# ---------------------------------------------------------------- loading
def load_step(path, tol=0.005, ang=0.1):
    """(B-rep shape, watertight mesh) for a STEP file."""
    shape = bd.import_step(str(path))
    with tempfile.TemporaryDirectory() as d:
        stl = Path(d) / "m.stl"
        bd.export_stl(shape, str(stl), tolerance=tol, angular_tolerance=ang)
        mesh = trimesh.load(stl)
    mesh.merge_vertices(digits_vertex=5)
    if not mesh.is_watertight:  # OCC can leave a micro-crack at 3-way fillet corners; the B-rep is valid
        trimesh.repair.fill_holes(mesh)
    return shape, mesh


def brep_stats(shape):
    bb = shape.bounding_box()
    return {
        "bbox_min": [round(bb.min.X, 3), round(bb.min.Y, 3), round(bb.min.Z, 3)],
        "bbox_max": [round(bb.max.X, 3), round(bb.max.Y, 3), round(bb.max.Z, 3)],
        "size_xyz": [round(bb.size.X, 2), round(bb.size.Y, 2), round(bb.size.Z, 2)],
        "volume_mm3": round(shape.volume, 2),
        "area_mm2": round(shape.area, 1),
        "faces": len(shape.faces()),
        "valid": bool(shape.is_valid),
        "solids": len(shape.solids()),
    }


# ---------------------------------------------------------------- draft / sides / parting line
def draft_deg(mesh):
    """Per-face draft to the pull: 0 = wall parallel to pull, 90 = face normal to pull."""
    return np.degrees(np.arcsin(np.clip(np.abs(mesh.face_normals @ PULL), 0, 1)))


def side_classes(mesh, undercut):
    """0 = cavity/A (+Y release), 1 = core/B (-Y release), 2 = undercut."""
    ny = mesh.face_normals @ PULL
    cls = np.where(ny >= 0, 0, 1)
    cls[undercut] = 2
    return cls


def parting_edges(mesh, cls, min_len=0.0):
    """Mesh edges shared by an A face and a B face (candidate parting line)."""
    fa = mesh.face_adjacency
    diff = cls[fa[:, 0]] != cls[fa[:, 1]]
    both_ok = (cls[fa[:, 0]] < 2) & (cls[fa[:, 1]] < 2)
    edges = mesh.face_adjacency_edges[diff & both_ok]
    segs = mesh.vertices[edges]
    if min_len:
        segs = segs[np.linalg.norm(segs[:, 0] - segs[:, 1], axis=1) >= min_len]
    return segs


# ---------------------------------------------------------------- wall thickness (inscribed sphere)
def sphere_thickness(mesh, pts, normals, rmax=3.5, iters=14):
    """Diameter of the largest sphere inside the part touching each point (Moldflow-style)."""
    lo = np.zeros(len(pts))
    hi = np.full(len(pts), rmax)
    for _ in range(iters):
        r = (lo + hi) / 2
        c = pts - normals * r[:, None]
        _, d, _ = trimesh.proximity.closest_point(mesh, c)
        ok = d >= r * (1 - 2e-3) - 1e-4
        lo = np.where(ok, r, lo)
        hi = np.where(ok, hi, r)
    return 2 * lo


def sample_thickness(mesh, n=30000, seed=3, edge_filter_mm=0.7):
    """Inscribed-sphere thickness at surface samples, then a local max-filter over `edge_filter_mm`.

    A sphere tangent at a point close to a convex edge escapes through the neighbouring face, which
    under-reads the wall there; taking the local maximum restores the wall value at edges while
    staying below the gap to the opposite skin of the thinnest (0.8 mm) features."""
    pts, fi = trimesh.sample.sample_surface_even(mesh, n, seed=seed)
    raw = sphere_thickness(mesh, pts, mesh.face_normals[fi])
    if not edge_filter_mm:
        return pts, raw
    tree = cKDTree(pts)
    nbrs = tree.query_ball_point(pts, edge_filter_mm)
    return pts, np.array([raw[i].max() for i in nbrs])


def to_faces(mesh, pts, vals):
    """Map sampled values onto the faces of `mesh` (nearest sample)."""
    _, idx = cKDTree(pts).query(mesh.triangles_center)
    return vals[idx]


# ---------------------------------------------------------------- flow-length proxy (geodesic)
def geodesic_from(mesh, point):
    """Shortest surface path length from the vertex nearest `point` to every vertex."""
    e = mesh.edges_unique
    w = mesh.edges_unique_length
    n = len(mesh.vertices)
    g = coo_matrix((np.r_[w, w], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
    src = int(np.argmin(np.linalg.norm(mesh.vertices - np.asarray(point), axis=1)))
    return dijkstra(g, indices=src), src


# ---------------------------------------------------------------- local flat-face check (ejector pins)
def flat_pad_ok(mesh, x, z, radius, y_face, from_below=True, tol=0.02, n=16, ray=None):
    """True if a disc of `radius` at (x, z) lands entirely on a face at Y = y_face."""
    ray = ray or trimesh.ray.ray_triangle.RayMeshIntersector(mesh)
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    xs = np.r_[x, x + radius * np.cos(ang)]
    zs = np.r_[z, z + radius * np.sin(ang)]
    y0 = -50.0 if from_below else 80.0
    o = np.c_[xs, np.full_like(xs, y0), zs]
    d = np.tile([0, 1 if from_below else -1, 0], (len(o), 1)).astype(float)
    loc, idx, _ = ray.intersects_location(o, d, multiple_hits=True)
    for i in range(len(o)):
        ys = loc[idx == i][:, 1]
        if not len(ys):
            return False
        first = ys.min() if from_below else ys.max()
        if abs(first - y_face) > tol:
            return False
    return True


# ---------------------------------------------------------------- section properties
def section_props(mesh, z):
    """Area, centroid Y and second moment about the X-parallel centroidal axis of the Z-section."""
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    sec = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    polys = [Polygon(p[:, [0, 1]]) for p in sec.discrete]
    polys.sort(key=lambda p: -p.area)
    shape = polys[0]
    for p in polys[1:]:
        shape = shape.difference(p) if shape.contains(p) else unary_union([shape, p])
    # exact polygon integrals (Green's theorem)
    def integrals(ring, sign):
        x, y = np.asarray(ring.coords).T
        a = x[:-1] * y[1:] - x[1:] * y[:-1]
        A = a.sum() / 2
        cy = ((y[:-1] + y[1:]) * a).sum() / 6
        iyy = ((y[:-1] ** 2 + y[:-1] * y[1:] + y[1:] ** 2) * a).sum() / 12
        return sign * abs(A), sign * np.sign(A) * cy, sign * np.sign(A) * iyy

    geoms = list(shape.geoms) if hasattr(shape, "geoms") else [shape]
    A = Sy = Ixx = 0.0
    for gm in geoms:
        for ring, sgn in [(gm.exterior, 1)] + [(r, -1) for r in gm.interiors]:
            a, s, i = integrals(ring, sgn)
            A += a
            Sy += s
            Ixx += i
    yc = Sy / A
    I = Ixx - A * yc ** 2
    ys = np.concatenate([np.asarray(gm.exterior.coords)[:, 1] for gm in geoms])
    return {"area_mm2": A, "yc": yc, "I_mm4": I, "c_mm": max(ys.max() - yc, yc - ys.min())}


# ---------------------------------------------------------------- rendering
def _view_xform(view):
    """Map part coords to plot coords: length (Z) horizontal, the viewed face up."""
    if view == "outer":  # look at +Y face
        return lambda P: np.c_[P[:, 2], P[:, 0], P[:, 1]]
    return lambda P: np.c_[P[:, 2], -P[:, 0], -P[:, 1]]  # inner (-Y) face


def render(ax, mesh, face_rgb, view="inner", elev=32, azim=-62, lines=None, points=None, light=(0.35, -0.5, 0.8),
           edge=None, title=None):
    from mpl_toolkits.mplot3d.art3d import Line3DCollection, Poly3DCollection

    T = _view_xform(view)
    tris = T(mesh.triangles.reshape(-1, 3)).reshape(-1, 3, 3)
    v1, v2 = tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    nrm = np.cross(v1, v2)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
    L = np.asarray(light) / np.linalg.norm(light)
    shade = 0.55 + 0.45 * np.clip(nrm @ L, 0, 1)
    rgb = np.clip(np.asarray(face_rgb)[:, :3] * shade[:, None], 0, 1)
    ax.add_collection3d(Poly3DCollection(tris, facecolors=rgb, edgecolors=rgb if edge is None else edge,
                                         linewidths=0.2, antialiased=False))
    if lines is not None and len(lines):
        ax.add_collection3d(Line3DCollection(T(lines.reshape(-1, 3)).reshape(-1, 2, 3), colors="#d62728", linewidths=1.6))
    if points:
        for p, style in points:
            q = T(np.atleast_2d(p))[0]
            ax.scatter(*q, **style)
    allp = tris.reshape(-1, 3)
    lo, hi = allp.min(0), allp.max(0)
    ax.set_xlim(lo[0], hi[0])
    ax.set_ylim(lo[1], hi[1])
    ax.set_zlim(lo[2], hi[2])
    ax.set_box_aspect(hi - lo)
    ax.set_proj_type("ortho")
    ax.view_init(elev=elev, azim=azim)
    ax.set_axis_off()
    if title:
        ax.set_title(title, fontsize=11, pad=0)
    return ax
