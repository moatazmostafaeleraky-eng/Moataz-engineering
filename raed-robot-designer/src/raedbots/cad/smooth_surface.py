"""Reverse-engineer a closed triangle mesh into a smooth BREP solid.

RoboDK library robots only carry tessellated visual meshes. A faceted STEP made
from them has one planar face per triangle. This module rebuilds surfaces the
way a reverse-engineering workflow does:

1. Segment the mesh into patches by growing analytic primitives (plane,
   cylinder, sphere) from seed triangles; whatever does not fit a primitive is
   grouped into freeform patches.
2. Split every patch into topological disks with a bounded normal spread.
3. Turn the patch borders into shared smooth edges (interpolated B-splines).
4. Build each face on its fitted surface: exact analytic surfaces where a
   primitive fits, a NURBS plate surface through the mesh points otherwise.
5. Sew the faces into a shell, make a solid, validate it in OpenCascade and
   measure its deviation from the source mesh.

The result is smooth geometry within a stated tolerance of the visual mesh; it
is not the manufacturer's design-intent CAD.
"""
from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

import numpy as np

PLANE, CYLINDER, SPHERE, CONE, FREE = "plane", "cylinder", "sphere", "cone", "free"
_DEBUG: list | None = None
_AREA_LOG: list | None = None
# A true curved face is up to a few percent larger than its chord facets; beyond this the trim is wrong.
_AREA_LIMIT = 0.08  # set to a list to collect per-patch build failures
_COMPLEXITY = {PLANE: 0, CYLINDER: 1, CONE: 2, SPHERE: 3, FREE: 4}


# ----------------------------------------------------------------------------
# Mesh topology
# ----------------------------------------------------------------------------
class Mesh:
    def __init__(self, vertices: np.ndarray, faces: np.ndarray):
        self.V = np.asarray(vertices, dtype=np.float64)
        self.F = np.asarray(faces, dtype=np.int64)
        cross = np.cross(self.V[self.F[:, 1]] - self.V[self.F[:, 0]], self.V[self.F[:, 2]] - self.V[self.F[:, 0]])
        self.area = np.linalg.norm(cross, axis=1) / 2
        self.normal = cross / (np.linalg.norm(cross, axis=1, keepdims=True) + 1e-30)
        self.centroid = self.V[self.F].mean(axis=1)
        # Directed half-edge -> face, and face adjacency through shared edges.
        self.half_edge: dict[tuple[int, int], int] = {}
        for f, (a, b, c) in enumerate(self.F.tolist()):
            self.half_edge[(a, b)] = f
            self.half_edge[(b, c)] = f
            self.half_edge[(c, a)] = f
        self.neighbors: list[list[int]] = [[] for _ in range(len(self.F))]
        for (a, b), f in self.half_edge.items():
            g = self.half_edge.get((b, a))
            if g is not None:
                self.neighbors[f].append(g)
        self.size = float(np.linalg.norm(self.V.max(0) - self.V.min(0)))


def _is_closed_manifold(faces: np.ndarray) -> bool:
    edges = np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    return bool((counts == 2).all())


def clean_mesh(vertices: np.ndarray, faces: np.ndarray, min_size_mm: float = 1e-3) -> tuple[np.ndarray, np.ndarray, dict]:
    """Remove micro-edges and needle triangles that OpenCascade cannot turn into edges or faces.

    Micro-edges are collapsed; a needle whose edges are not tiny gets its long edge
    flipped instead, which keeps every vertex where it is. The result must stay a
    closed 2-manifold, otherwise the input is returned unchanged.
    """
    V = np.asarray(vertices, dtype=np.float64).copy()
    F = np.asarray(faces, dtype=np.int64).copy()
    collapsed = flipped = 0
    for _ in range(20):
        tri = V[F]
        lengths = np.stack([np.linalg.norm(tri[:, (i + 1) % 3] - tri[:, i], axis=1) for i in range(3)], axis=1)
        area2 = np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
        altitude = area2 / np.maximum(lengths.max(axis=1), 1e-30)
        bad = np.where((lengths.min(axis=1) < min_size_mm) | (altitude < min_size_mm))[0]
        if not len(bad):
            break
        half = {}
        for f, (a, b, c) in enumerate(F.tolist()):
            half[(a, b)] = f
            half[(b, c)] = f
            half[(c, a)] = f
        remap = np.arange(len(V))
        touched: set[int] = set()
        changed = False
        for f in bad.tolist():
            tri_v = F[f].tolist()
            if touched & set(tri_v):
                continue
            k = int(np.argmin(lengths[f]))
            if lengths[f, k] < min_size_mm:
                a, b = tri_v[k], tri_v[(k + 1) % 3]
                remap[b] = a
                touched.update(tri_v)
                collapsed += 1
                changed = True
                continue
            # Needle: flip the longest edge with the triangle on its other side.
            k = int(np.argmax(lengths[f]))
            a, b, c = tri_v[k], tri_v[(k + 1) % 3], tri_v[(k + 2) % 3]
            g = half.get((b, a))
            if g is None:
                continue
            d = [v for v in F[g].tolist() if v not in (a, b)][0]
            if touched & set(F[g].tolist()) or (c, d) in half or (d, c) in half or c == d:
                continue
            F[f] = [c, a, d]
            F[g] = [d, b, c]
            touched.update([a, b, c, d])
            flipped += 1
            changed = True
        if not changed:
            break
        F = remap[F]
        F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    used = np.unique(F)
    index = -np.ones(len(V), dtype=np.int64)
    index[used] = np.arange(len(used))
    V2, F2 = V[used], index[F]
    if not _is_closed_manifold(F2):
        return np.asarray(vertices, float), np.asarray(faces, np.int64), {"cleanup": "skipped_non_manifold_result"}
    return V2, F2, {"collapsed_micro_edges": collapsed, "flipped_needles": flipped}


# ----------------------------------------------------------------------------
# Primitive fitting
# ----------------------------------------------------------------------------
def _fit_plane(points: np.ndarray):
    centre = points.mean(axis=0)
    _, _, vt = np.linalg.svd(points - centre, full_matrices=False)
    return {"kind": PLANE, "point": centre, "normal": vt[2]}


def _fit_circle_2d(xy: np.ndarray):
    A = np.c_[2 * xy, np.ones(len(xy))]
    b = (xy ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    centre = sol[:2]
    radius_sq = sol[2] + centre @ centre
    return centre, float(np.sqrt(radius_sq)) if radius_sq > 0 else None


def _orthonormal(axis: np.ndarray):
    helper = np.array([1.0, 0.0, 0.0]) if abs(axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    u = np.cross(axis, helper)
    u /= np.linalg.norm(u)
    return u, np.cross(axis, u)


def _fit_cylinder(points: np.ndarray, normals: np.ndarray, weights: np.ndarray):
    if len(points) < 6:
        return None
    M = (normals * weights[:, None]).T @ normals
    eigval, eigvec = np.linalg.eigh(M)
    # Normals of a cylinder span a plane: one near-zero and two significant eigenvalues.
    if eigval[1] < 0.05 * eigval[2]:
        return None
    axis = eigvec[:, 0]
    u, v = _orthonormal(axis)
    centre2d, radius = _fit_circle_2d(np.c_[points @ u, points @ v])
    if radius is None:
        return None
    point = centre2d[0] * u + centre2d[1] * v
    return {"kind": CYLINDER, "point": point, "axis": axis, "radius": radius}


def _fit_sphere(points: np.ndarray):
    if len(points) < 6:
        return None
    A = np.c_[2 * points, np.ones(len(points))]
    b = (points ** 2).sum(axis=1)
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    centre = sol[:3]
    radius_sq = sol[3] + centre @ centre
    if radius_sq <= 0:
        return None
    return {"kind": SPHERE, "centre": centre, "radius": float(np.sqrt(radius_sq))}


def _cone_terms(prim: dict, points: np.ndarray):
    """Axial height h above the reference point, radial distance r and radial vectors."""
    v = points - prim["point"]
    h = v @ prim["axis"]
    radial = v - np.outer(h, prim["axis"])
    r = np.linalg.norm(radial, axis=1)
    return h, r, radial


def _cone_from_band(points: np.ndarray, normals: np.ndarray, weights: np.ndarray):
    """Cone (incl. slightly drafted cylinders) parametrised like a CAD kernel:
    reference point on the axis, axis, radius at that point and half-angle.
    Initialised from the cylinder fit, so a 0.2 degree draft is as well-posed as a chamfer."""
    from scipy.optimize import least_squares

    if len(points) < 8:
        return None
    M = (normals * weights[:, None]).T @ normals
    eigval, eigvec = np.linalg.eigh(M)
    axis = eigvec[:, 0]
    # For a cone the normals lie on a circle on the unit sphere: a plane fit to them gives the axis.
    centre_n = (normals * weights[:, None]).sum(0) / weights.sum()
    _, sv, vt = np.linalg.svd((normals - centre_n) * np.sqrt(weights)[:, None], full_matrices=False)
    if sv[1] > 1e-6:
        axis = vt[2]
    u, v = _orthonormal(axis)
    centre2d, radius = _fit_circle_2d(np.c_[points @ u, points @ v])
    if radius is None:
        return None
    h0 = float(np.median(points @ axis))
    p0 = centre2d[0] * u + centre2d[1] * v + h0 * axis

    def residual(x):
        ax = x[3:6] / np.linalg.norm(x[3:6])
        prim = {"point": x[:3], "axis": ax}
        hh, rr, _ = _cone_terms(prim, points)
        return (rr - x[6] - hh * np.tan(x[7])) * np.cos(x[7])

    sol = least_squares(residual, np.r_[p0, axis, radius, 0.0], max_nfev=300)
    ax = sol.x[3:6] / np.linalg.norm(sol.x[3:6])
    alpha = float(sol.x[7])
    r0 = float(sol.x[6])
    if alpha < 0:  # keep the cone opening along +axis
        ax, alpha = -ax, -alpha
    if not np.radians(0.2) < alpha < np.radians(80) or r0 <= 0:
        return None
    return {"kind": CONE, "point": sol.x[:3], "axis": ax, "radius": r0, "alpha": alpha}


def _fit_cone(points: np.ndarray, normals: np.ndarray, centroids: np.ndarray, weights: np.ndarray):
    return _cone_from_band(points, normals, weights)


def _distance(prim: dict, points: np.ndarray) -> np.ndarray:
    if prim["kind"] == PLANE:
        return np.abs((points - prim["point"]) @ prim["normal"])
    if prim["kind"] == CYLINDER:
        rel = points - prim["point"]
        radial = rel - np.outer(rel @ prim["axis"], prim["axis"])
        return np.abs(np.linalg.norm(radial, axis=1) - prim["radius"])
    if prim["kind"] == SPHERE:
        return np.abs(np.linalg.norm(points - prim["centre"], axis=1) - prim["radius"])
    if prim["kind"] == CONE:
        h, r, _ = _cone_terms(prim, points)
        return np.abs(r - prim["radius"] - h * np.tan(prim["alpha"])) * np.cos(prim["alpha"])
    raise ValueError(prim["kind"])


def _surface_normal(prim: dict, points: np.ndarray) -> np.ndarray:
    if prim["kind"] == PLANE:
        return np.repeat(prim["normal"][None, :], len(points), axis=0)
    if prim["kind"] == CYLINDER:
        rel = points - prim["point"]
        radial = rel - np.outer(rel @ prim["axis"], prim["axis"])
    elif prim["kind"] == CONE:
        _, _, radial = _cone_terms(prim, points)
        radial = radial / (np.linalg.norm(radial, axis=1, keepdims=True) + 1e-30)
        return radial * np.cos(prim["alpha"]) - np.outer(np.ones(len(points)), prim["axis"]) * np.sin(prim["alpha"])
    else:
        radial = points - prim["centre"]
    return radial / (np.linalg.norm(radial, axis=1, keepdims=True) + 1e-30)


def _project(prim: dict, p: np.ndarray) -> np.ndarray:
    """Closest point on an analytic surface."""
    if prim["kind"] == PLANE:
        return p - ((p - prim["point"]) @ prim["normal"]) * prim["normal"]
    if prim["kind"] == SPHERE:
        d = p - prim["centre"]
        return prim["centre"] + prim["radius"] * d / (np.linalg.norm(d) + 1e-30)
    v = p - prim["point"]
    h = v @ prim["axis"]
    radial = v - h * prim["axis"]
    r = np.linalg.norm(radial)
    unit = radial / r if r > 1e-12 else _orthonormal(prim["axis"])[0]
    if prim["kind"] == CYLINDER:
        return prim["point"] + h * prim["axis"] + prim["radius"] * unit
    # Cone: project (h, r) onto the generator line r = r0 + h tan(alpha) in the meridian plane.
    t = np.tan(prim["alpha"])
    direction = np.array([1.0, t]) / np.hypot(1.0, t)
    base = np.array([0.0, prim["radius"]])
    q = base + ((np.array([h, r]) - base) @ direction) * direction
    return prim["point"] + q[0] * prim["axis"] + q[1] * unit


def snap_boundary_vertices(mesh: Mesh, labels: np.ndarray, prims: list[dict], tol: float) -> tuple[np.ndarray, int]:
    """Move vertices shared by analytic patches onto the intersection of those surfaces.

    Mesh vertices sit up to the fit tolerance off each fitted surface, so curves
    through them would only touch the faces within that tolerance. Alternating
    projection puts a two-patch vertex on the intersection curve and a three-patch
    vertex on the corner, so every shared edge lies on both of its faces.
    """
    V = mesh.V.copy()
    touching: dict[int, set[int]] = defaultdict(set)
    for f, tri in enumerate(mesh.F.tolist()):
        for v in tri:
            touching[v].add(int(labels[f]))
    moved = 0
    for v, pids in touching.items():
        surfaces = [prims[p] for p in pids if prims[p]["kind"] != FREE]
        if not surfaces:
            continue
        p = V[v].copy()
        for _ in range(60):
            previous = p
            for prim in surfaces:
                p = _project(prim, p)
            if np.linalg.norm(p - previous) < 1e-7:
                break
        if max(float(_distance(prim, p[None, :])[0]) for prim in surfaces) < 1e-3 and np.linalg.norm(p - V[v]) < 2 * tol:
            V[v] = p
            moved += 1
    # Two neighbours snapped onto the same corner would leave a zero-length edge: undo those moves.
    edges = np.unique(np.sort(np.concatenate([mesh.F[:, [0, 1]], mesh.F[:, [1, 2]], mesh.F[:, [2, 0]]]), axis=1), axis=0)
    for _ in range(5):
        short = edges[np.linalg.norm(V[edges[:, 0]] - V[edges[:, 1]], axis=1) < 1e-3]
        restore = [v for v in np.unique(short) if not np.allclose(V[v], mesh.V[v])]
        if not restore:
            break
        V[restore] = mesh.V[restore]
        moved -= len(restore)
    return V, moved


def _refit(prim: dict, mesh: Mesh, faces: list[int]):
    vids = np.unique(mesh.F[faces])
    points = mesh.V[vids]
    if prim["kind"] == PLANE:
        return _fit_plane(points)
    if prim["kind"] == CYLINDER:
        return _fit_cylinder(points, mesh.normal[faces], mesh.area[faces])
    if prim["kind"] == CONE:
        return _fit_cone(points, mesh.normal[faces], mesh.centroid[faces], mesh.area[faces])
    return _fit_sphere(points)


# ----------------------------------------------------------------------------
# Segmentation
# ----------------------------------------------------------------------------
def _well_posed(prim: dict, mesh: Mesh, faces: list[int]) -> bool:
    """Reject curved fits that the patch cannot determine: too little curvature, huge radius, apex inside."""
    if prim["kind"] == PLANE:
        return True
    n = mesh.normal[faces]
    w = mesh.area[faces]
    mean = (n * w[:, None]).sum(0)
    mean /= np.linalg.norm(mean) + 1e-30
    if float((n @ mean).min()) > np.cos(np.radians(12)):
        return False
    pts = mesh.V[np.unique(mesh.F[faces])]
    # Several times more points than primitive parameters, so a fit cannot pass by chance.
    if len(pts) < {CYLINDER: 8, SPHERE: 12, CONE: 20}[prim["kind"]]:
        return False
    if prim["kind"] in (CYLINDER, SPHERE) and prim["radius"] > 0.5 * mesh.size:
        return False
    if prim["kind"] == SPHERE:
        # A sphere's normals spread in every direction; a band of a cylinder or cone does not.
        eig = np.linalg.eigvalsh((n * w[:, None]).T @ n)
        if eig[0] < 0.05 * eig[2]:
            return False
    if prim["kind"] == CONE:
        if not np.radians(0.2) < prim["alpha"] < np.radians(75):
            return False
        h, r, _ = _cone_terms(prim, pts)
        local_radius = prim["radius"] + h * np.tan(prim["alpha"])
        # The apex must stay well outside the patch and the cone must stay part-sized.
        if local_radius.min() < 0.1 * local_radius.max() or r.max() > 0.5 * mesh.size:
            return False
    return True


def _grow(mesh: Mesh, prim: dict, seed: int, free: np.ndarray, tol: float, normal_cos: float) -> list[int]:
    region, queue, seen = [], deque([seed]), {seed}
    while queue:
        f = queue.popleft()
        verts = mesh.V[mesh.F[f]]
        if _distance(prim, verts).max() > tol:
            continue
        n_surf = _surface_normal(prim, mesh.centroid[f][None, :])[0]
        if abs(n_surf @ mesh.normal[f]) < normal_cos:
            continue
        region.append(f)
        for g in mesh.neighbors[f]:
            if free[g] and g not in seen:
                seen.add(g)
                queue.append(g)
    return region


def _local_faces(mesh: Mesh, seed: int, free: np.ndarray, rings: int) -> list[int]:
    found, frontier = {seed}, [seed]
    for _ in range(rings):
        nxt = []
        for f in frontier:
            for g in mesh.neighbors[f]:
                if free[g] and g not in found:
                    found.add(g)
                    nxt.append(g)
        frontier = nxt
    return list(found)


def _cylinder_hypotheses(mesh: Mesh, seed: int, free: np.ndarray, tol: float) -> list[dict]:
    """Cylinders through the seed: the axis is the cross product of two adjacent facet normals."""
    out = []
    n0 = mesh.normal[seed]
    for g in mesh.neighbors[seed]:
        c = float(n0 @ mesh.normal[g])
        if not (0.70 < c < 0.9995):
            continue
        axis = np.cross(n0, mesh.normal[g])
        axis /= np.linalg.norm(axis)
        # Collect the connected faces whose normals are perpendicular to this axis.
        band, queue, seen = [], deque([seed]), {seed}
        while queue and len(band) < 400:
            f = queue.popleft()
            if abs(mesh.normal[f] @ axis) > 0.12:
                continue
            band.append(f)
            for h in mesh.neighbors[f]:
                if free[h] and h not in seen:
                    seen.add(h)
                    queue.append(h)
        if len(band) < 3:
            continue
        pts = mesh.V[np.unique(mesh.F[band])]
        u, v = _orthonormal(axis)
        centre2d, radius = _fit_circle_2d(np.c_[pts @ u, pts @ v])
        if radius is None or radius > mesh.size:
            continue
        cyl = {"kind": CYLINDER, "point": centre2d[0] * u + centre2d[1] * v, "axis": axis, "radius": radius}
        if np.median(_distance(cyl, pts)) < tol:
            out.append(cyl)
        elif len(pts) >= 20:
            # Not a cylinder: the same band may be a drafted (conical) surface.
            cone = _cone_from_band(pts, mesh.normal[band], mesh.area[band])
            if cone is not None and np.median(_distance(cone, pts)) < tol:
                out.append(cone)
        break
    return out


def _sphere_hypothesis(mesh: Mesh, seed: int, free: np.ndarray, tol: float) -> list[dict]:
    local = [f for f in _local_faces(mesh, seed, free, 2) if mesh.normal[f] @ mesh.normal[seed] > 0.5]
    if len(local) < 6:
        return []
    N = mesh.normal[local]
    eig = np.linalg.eigvalsh(N.T @ N)
    # A sphere's normals spread in every direction; a cylinder's share one perpendicular axis.
    if eig[0] < 0.02 * eig[2] or eig[1] < 0.02 * eig[2]:
        return []
    pts = mesh.V[np.unique(mesh.F[local])]
    sph = _fit_sphere(pts)
    if sph and sph["radius"] < mesh.size and _distance(sph, pts).max() < tol:
        return [sph]
    return []


def _is_curved_facet(mesh: Mesh, region: list[int]) -> bool:
    """A small 'plane' whose borders continue smoothly is a facet of a curved surface."""
    inside = set(region)
    smooth = total = 0.0
    for f in region:
        for g in mesh.neighbors[f]:
            if g in inside:
                continue
            shared = set(mesh.F[f].tolist()) & set(mesh.F[g].tolist())
            if len(shared) != 2:
                continue
            a, b = (mesh.V[i] for i in shared)
            length = float(np.linalg.norm(a - b))
            total += length
            if mesh.normal[f] @ mesh.normal[g] > np.cos(np.radians(25)):
                smooth += length
    return total > 0 and smooth / total > 0.5


def segment(mesh: Mesh, tol: float) -> tuple[np.ndarray, list[dict]]:
    """Label every face with a patch id; analytic patches carry their primitive."""
    labels = -np.ones(len(mesh.F), dtype=np.int64)
    prims: list[dict] = []
    free = np.ones(len(mesh.F), dtype=bool)
    min_area = (0.004 * mesh.size) ** 2
    for seed in np.argsort(-mesh.area):
        if not free[seed]:
            continue
        best_region, best_prim = None, None
        candidates = [{"kind": PLANE, "point": mesh.centroid[seed], "normal": mesh.normal[seed]}]
        candidates += _cylinder_hypotheses(mesh, seed, free, tol)
        candidates += _sphere_hypothesis(mesh, seed, free, tol)
        for prim in candidates:
            normal_cos = 0.985 if prim["kind"] == PLANE else 0.94
            region = _grow(mesh, prim, seed, free, tol, normal_cos)
            if len(region) >= 3:
                refit = _refit(prim, mesh, region)
                if refit is not None and _distance(refit, mesh.V[np.unique(mesh.F[region])]).max() < tol:
                    grown = _grow(mesh, refit, seed, free, tol, normal_cos)
                    if len(grown) >= len(region):
                        region, prim = grown, refit
            if prim["kind"] == PLANE and len(region) <= 6 and _is_curved_facet(mesh, region):
                region = []
            if region and not _well_posed(prim, mesh, region):
                region = []
            area = mesh.area[region].sum() if region else 0.0
            if best_region is None:
                best_region, best_prim = region, prim
                continue
            best_area = mesh.area[best_region].sum()
            simpler = _COMPLEXITY[prim["kind"]] < _COMPLEXITY[best_prim["kind"]]
            # A more complex surface must explain clearly more area than a simpler one.
            if (simpler and area >= 0.97 * best_area) or (not simpler and area > 1.03 * best_area):
                best_region, best_prim = region, prim
        # Accept analytic patches that are more than a lone facet of a curved surface.
        enough = len(best_region) >= (2 if best_prim["kind"] == PLANE else 6) and _well_posed(best_prim, mesh, best_region)
        if best_region and enough and mesh.area[best_region].sum() >= min_area:
            pid = len(prims)
            prims.append(best_prim)
            labels[best_region] = pid
            free[best_region] = False
    # Remaining faces form freeform patches by connectivity.
    for f in range(len(mesh.F)):
        if labels[f] >= 0:
            continue
        pid = len(prims)
        prims.append({"kind": FREE})
        queue = deque([f])
        labels[f] = pid
        while queue:
            g = queue.popleft()
            for h in mesh.neighbors[g]:
                if labels[h] < 0:
                    labels[h] = pid
                    queue.append(h)
    return labels, prims


def merge_facet_strips(mesh: Mesh, labels: np.ndarray, prims: list[dict], tol: float) -> tuple[np.ndarray, list[dict]]:
    """Merge chains of small planar patches that are the coarse facets of one curved surface.

    A chamfer or small bore tessellated with 8-16 segments meets its neighbours at
    20-45 degrees, so each facet first looks like its own plane. If a connected strip
    of such facets fits one cone, cylinder or sphere, it becomes that surface.
    """
    labels = labels.copy()
    counts = np.bincount(labels, minlength=len(prims))
    small = {pid for pid, p in enumerate(prims) if p["kind"] == PLANE and 0 < counts[pid] <= 8}
    adj: dict[int, set[int]] = defaultdict(set)
    for (a, b), f in mesh.half_edge.items():
        g = mesh.half_edge.get((b, a))
        if g is None:
            continue
        pa, pb = int(labels[f]), int(labels[g])
        if pa != pb and pa in small and pb in small:
            if prims[pa]["normal"] @ prims[pb]["normal"] > np.cos(np.radians(50)):
                adj[pa].add(pb)
    seen: set[int] = set()
    for start in list(adj):
        if start in seen:
            continue
        group, queue = [], deque([start])
        seen.add(start)
        while queue:
            q = queue.popleft()
            group.append(q)
            for r in adj[q]:
                if r not in seen:
                    seen.add(r)
                    queue.append(r)
        if len(group) < 3:
            continue
        faces = np.where(np.isin(labels, group))[0].tolist()
        pts = mesh.V[np.unique(mesh.F[faces])]
        fits = [
            _fit_cylinder(pts, mesh.normal[faces], mesh.area[faces]),
            _fit_cone(pts, mesh.normal[faces], mesh.centroid[faces], mesh.area[faces]),
            _fit_sphere(pts),
        ]
        best = None
        for prim in fits:
            if prim is None or not _well_posed(prim, mesh, faces):
                continue
            err = float(_distance(prim, pts).max())
            # Prefer the simplest surface that fits: cylinder, then cone, then sphere.
            if err < tol:
                best = (err, prim)
                break
        if best is None:
            continue
        pid = len(prims)
        prims.append(best[1])
        labels[faces] = pid
    return labels, prims


def demote_small_primitives(mesh: Mesh, labels: np.ndarray, prims: list[dict]) -> tuple[np.ndarray, list[dict]]:
    """Return small analytic patches that blend smoothly into their surroundings to the freeform pool,
    then regroup all freeform faces into connected regions."""
    labels = labels.copy()
    counts = np.bincount(labels, minlength=len(prims))
    for pid, prim in enumerate(prims):
        if prim["kind"] == FREE or counts[pid] == 0:
            continue
        limit = 4 if prim["kind"] == PLANE else 12
        if counts[pid] < limit:
            faces = np.where(labels == pid)[0].tolist()
            if _is_curved_facet(mesh, faces):
                prims[pid] = {"kind": FREE}
    # Regroup freeform faces by connectivity.
    free = np.array([prims[l]["kind"] == FREE for l in labels])
    new_labels = labels.copy()
    seen = np.zeros(len(labels), dtype=bool)
    for f in np.where(free)[0]:
        if seen[f]:
            continue
        pid = len(prims)
        prims.append({"kind": FREE})
        queue = deque([f])
        seen[f] = True
        while queue:
            g = queue.popleft()
            new_labels[g] = pid
            for h in mesh.neighbors[g]:
                if free[h] and not seen[h]:
                    seen[h] = True
                    queue.append(h)
    return new_labels, prims


def promote_free_regions(mesh: Mesh, labels: np.ndarray, prims: list[dict], tol: float) -> list[dict]:
    """Turn a whole freeform region into a cylinder, cone or sphere when one fits all of it.

    Seed-based growth cannot propose every surface (a cone's neighbouring facets give a
    generator, not the axis); fitting the complete region catches those.
    """
    counts = np.bincount(labels, minlength=len(prims))
    for pid, prim in enumerate(prims):
        if prim["kind"] != FREE or counts[pid] < 8:
            continue
        faces = np.where(labels == pid)[0].tolist()
        pts = mesh.V[np.unique(mesh.F[faces])]
        for fit in (
            _fit_cylinder(pts, mesh.normal[faces], mesh.area[faces]),
            _cone_from_band(pts, mesh.normal[faces], mesh.area[faces]),
            _fit_sphere(pts),
        ):
            if fit is not None and _well_posed(fit, mesh, faces) and float(_distance(fit, pts).max()) < tol:
                prims[pid] = fit
                break
    return prims


def absorb_slivers(mesh: Mesh, labels: np.ndarray, prims: list[dict], tol: float) -> np.ndarray:
    """Give leftover freeform triangles to a neighbouring analytic patch whose surface they lie on."""
    labels = labels.copy()
    for _ in range(3):
        changed = 0
        counts = np.bincount(labels, minlength=len(prims))
        for f in np.where([prims[l]["kind"] == FREE and counts[l] <= 3 for l in labels])[0]:
            verts = mesh.V[mesh.F[f]]
            for g in mesh.neighbors[f]:
                prim = prims[labels[g]]
                if prim["kind"] != FREE and _distance(prim, verts).max() < 2 * tol:
                    labels[f] = labels[g]
                    changed += 1
                    break
        if not changed:
            break
    return labels


# ----------------------------------------------------------------------------
# Patch splitting
# ----------------------------------------------------------------------------
def _boundary_half_edges(mesh: Mesh, labels: np.ndarray, faces: list[int]) -> list[tuple[int, int, int]]:
    out = []
    for f in faces:
        a, b, c = mesh.F[f].tolist()
        for u, v in ((a, b), (b, c), (c, a)):
            g = mesh.half_edge.get((v, u))
            if g is None or labels[g] != labels[f]:
                out.append((u, v, f))
    return out


def _loop_count(mesh: Mesh, labels: np.ndarray, faces: list[int]) -> int:
    """Number of boundary loops of a patch (connected components of its boundary edges)."""
    edges = _boundary_half_edges(mesh, labels, faces)
    parent: dict[int, int] = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for u, v, _ in edges:
        parent[find(u)] = find(v)
    return len({find(u) for u, _, _ in edges})


def _split_in_two(mesh: Mesh, faces: list[int]) -> tuple[list[int], list[int]]:
    """Geodesic Voronoi split of a connected face set between its two most distant faces."""
    inside = set(faces)

    def bfs(start):
        dist = {start: 0}
        queue = deque([start])
        while queue:
            f = queue.popleft()
            for g in mesh.neighbors[f]:
                if g in inside and g not in dist:
                    dist[g] = dist[f] + 1
                    queue.append(g)
        return dist

    d0 = bfs(faces[0])
    a = max(d0, key=d0.get)
    da = bfs(a)
    b = max(da, key=da.get)
    db = bfs(b)
    first = [f for f in faces if da.get(f, 0) <= db.get(f, 0)]
    second = [f for f in faces if da.get(f, 0) > db.get(f, 0)]
    return first, second


def _normal_spread_ok(mesh: Mesh, faces: list[int], max_deg: float) -> bool:
    w = mesh.area[faces]
    mean = (mesh.normal[faces] * w[:, None]).sum(axis=0)
    norm = np.linalg.norm(mean)
    if norm < 1e-12:
        return False
    return float((mesh.normal[faces] @ (mean / norm)).min()) > np.cos(np.radians(max_deg))


def _split_at_creases(mesh: Mesh, faces: list[int], crease_deg: float = 25.0) -> list[list[int]]:
    """Connected pieces of a patch across edges smoother than the crease angle."""
    members = set(faces)
    limit = np.cos(np.radians(crease_deg))
    pieces = []
    while members:
        start = members.pop()
        comp, queue = [start], deque([start])
        while queue:
            f = queue.popleft()
            for g in mesh.neighbors[f]:
                if g in members and mesh.normal[f] @ mesh.normal[g] > limit:
                    members.discard(g)
                    comp.append(g)
                    queue.append(g)
        pieces.append(comp)
    return pieces


def _split_by_normals(mesh: Mesh, faces: list[int]) -> list[list[int]]:
    """Two-means on face normals, then connected components: pieces follow natural surface regions."""
    n = mesh.normal[faces]
    w = mesh.area[faces]
    i = int(np.argmin(n @ ((n * w[:, None]).sum(0))))
    centres = np.stack([n[int(np.argmin(n @ n[i]))], n[i]])
    for _ in range(10):
        assign = np.argmax(n @ centres.T, axis=1)
        for k in range(2):
            if (assign == k).any():
                c = (n[assign == k] * w[assign == k, None]).sum(0)
                centres[k] = c / (np.linalg.norm(c) + 1e-30)
    pieces = []
    for k in range(2):
        members = {faces[j] for j in np.where(assign == k)[0]}
        while members:
            start = members.pop()
            comp, queue = [start], deque([start])
            while queue:
                f = queue.popleft()
                for g in mesh.neighbors[f]:
                    if g in members:
                        members.discard(g)
                        comp.append(g)
                        queue.append(g)
            pieces.append(comp)
    return pieces


def split_patches(mesh: Mesh, labels: np.ndarray, prims: list[dict]) -> tuple[np.ndarray, list[dict]]:
    """Make every non-planar patch a single-loop disk; freeform patches also get a bounded normal spread."""
    labels = labels.copy()
    prims = list(prims)
    work = deque(range(len(prims)))
    while work:
        pid = work.popleft()
        faces = np.where(labels == pid)[0].tolist()
        if len(faces) < 2 or prims[pid]["kind"] == PLANE:
            continue
        if prims[pid]["kind"] == FREE:
            # Freeform patches keep their holes (trimmed B-spline); split at creases, then by curvature.
            pieces = _split_at_creases(mesh, faces)
            if len(pieces) < 2:
                if _normal_spread_ok(mesh, faces, 65.0):
                    continue
                pieces = _split_by_normals(mesh, faces)
                if len(pieces) < 2:
                    pieces = list(_split_in_two(mesh, faces))
        else:
            if _loop_count(mesh, labels, faces) == 1:
                continue
            pieces = list(_split_in_two(mesh, faces))
        pieces = [p for p in pieces if p]
        if len(pieces) < 2:
            continue
        for piece in pieces[1:]:
            new = len(prims)
            prims.append(dict(prims[pid]))
            labels[piece] = new
            work.append(new)
        work.append(pid)
    return labels, prims


# ----------------------------------------------------------------------------
# Patch boundaries -> loops -> chains
# ----------------------------------------------------------------------------
def patch_loops(mesh: Mesh, labels: np.ndarray, pid: int) -> list[list[tuple[int, int, int]]]:
    """Ordered boundary loops of a patch as (u, v, neighbour_label) half-edges, CCW w.r.t. the outward normal."""
    faces = np.where(labels == pid)[0].tolist()
    edges = _boundary_half_edges(mesh, labels, faces)
    by_start: dict[int, list[tuple[int, int, int]]] = defaultdict(list)
    for u, v, f in edges:
        by_start[u].append((u, v, f))

    def next_edge(u, v, f):
        # Rotate around v inside the patch until reaching the outgoing boundary half-edge.
        cur_face, prev = f, u
        for _ in range(64):
            tri = mesh.F[cur_face].tolist()
            i = tri.index(v)
            w = tri[(i + 1) % 3]
            g = mesh.half_edge.get((w, v))
            if g is None or labels[g] != pid:
                return (v, w, cur_face)
            cur_face, prev = g, w
        return None

    used: set[tuple[int, int]] = set()
    loops = []
    for start in edges:
        if (start[0], start[1]) in used:
            continue
        loop, cur = [], start
        while cur and (cur[0], cur[1]) not in used:
            used.add((cur[0], cur[1]))
            g = mesh.half_edge.get((cur[1], cur[0]))
            loop.append((cur[0], cur[1], int(labels[g]) if g is not None else -1))
            cur = next_edge(*cur)
        if loop and loop[-1][1] == loop[0][0]:
            loops.append(loop)
    return loops


def chains_of_loop(loop: list[tuple[int, int, int]]) -> list[tuple[list[int], int]]:
    """Split a loop where the neighbouring patch changes; each chain is (vertex list, neighbour)."""
    n = len(loop)
    cuts = [i for i in range(n) if loop[i][2] != loop[i - 1][2]]
    if not cuts:
        return [([e[0] for e in loop] + [loop[0][0]], loop[0][2])]
    chains = []
    for k, start in enumerate(cuts):
        end = cuts[(k + 1) % len(cuts)]
        idx = list(range(start, end if end > start else end + n))
        verts = [loop[i % n][0] for i in idx] + [loop[(idx[-1]) % n][1]]
        chains.append((verts, loop[start][2]))
    return chains


# ----------------------------------------------------------------------------
# BREP construction
# ----------------------------------------------------------------------------
def _occ():
    from OCP import BRepBuilderAPI, BRepOffsetAPI, GeomAPI, Geom, gp, TColgp, ShapeFix, GeomAbs
    from OCP.TopoDS import TopoDS
    return {"BRepBuilderAPI": BRepBuilderAPI, "BRepOffsetAPI": BRepOffsetAPI, "GeomAPI": GeomAPI, "Geom": Geom,
            "gp": gp, "TColgp": TColgp, "ShapeFix": ShapeFix, "GeomAbs": GeomAbs, "TopoDS": TopoDS}


def _canonical(verts: list[int]) -> tuple[tuple[int, ...], bool]:
    """Key shared by a chain and its reverse; the flag says whether verts are reversed w.r.t. the key."""
    closed = verts[0] == verts[-1]
    if closed:
        ring = verts[:-1]
        i = ring.index(min(ring))
        fwd = ring[i:] + ring[:i]
        rev = [fwd[0]] + fwd[1:][::-1]
        if tuple(rev) < tuple(fwd):
            return tuple(rev + [rev[0]]), True
        return tuple(fwd + [fwd[0]]), False
    if tuple(verts[::-1]) < tuple(verts):
        return tuple(verts[::-1]), True
    return tuple(verts), False


class _EdgeBank:
    """One OpenCascade edge per boundary chain, shared by both neighbouring faces."""

    def __init__(self, mesh: Mesh, polyline: frozenset[int] = frozenset(), prims: list[dict] | None = None):
        o = _occ()
        self.o, self.mesh, self.prims = o, mesh, prims
        # Patches built from their triangles: every chain touching them stays a polyline
        # of the original mesh edges, so both sides share exactly the same edges.
        self.polyline = polyline
        self.vertices: dict[int, Any] = {}
        self.edges: dict[tuple[int, ...], Any] = {}
        self.segments: dict[tuple[int, int], Any] = {}

    def segment(self, a: int, b: int):
        key = (min(a, b), max(a, b))
        if key not in self.segments:
            self.segments[key] = self.o["BRepBuilderAPI"].BRepBuilderAPI_MakeEdge(self.vertex(key[0]), self.vertex(key[1])).Edge()
        e = self.segments[key]
        return e if a < b else self.o["TopoDS"].Edge_s(e.Reversed())

    def vertex(self, vid):
        if vid not in self.vertices:
            p = self.mesh.V[vid]
            self.vertices[vid] = self.o["BRepBuilderAPI"].BRepBuilderAPI_MakeVertex(self.o["gp"].gp_Pnt(*map(float, p))).Vertex()
        return self.vertices[vid]

    def _curve(self, pts: np.ndarray, closed: bool):
        o = self.o
        if closed:
            pts = pts[:-1]
        # Straight chains stay lines.
        if not closed and len(pts) >= 2:
            d = pts[-1] - pts[0]
            L = np.linalg.norm(d)
            if L > 1e-9:
                off = np.linalg.norm(np.cross(pts - pts[0], d / L), axis=1).max()
                if off < 1e-3 or len(pts) == 2:
                    return None
        arr = o["TColgp"].TColgp_HArray1OfPnt(1, len(pts))
        for i, p in enumerate(pts, start=1):
            arr.SetValue(i, o["gp"].gp_Pnt(*map(float, p)))
        interp = o["GeomAPI"].GeomAPI_Interpolate(arr, bool(closed), 1e-6)
        interp.Perform()
        if not interp.IsDone():
            raise ValueError("chain interpolation failed")
        return interp.Curve()

    def edge(self, verts: list[int], surfaces: tuple = ()):
        key, reversed_ = _canonical(verts)
        if key not in self.edges:
            o = self.o
            pts = self.mesh.V[list(key)]
            closed = key[0] == key[-1]
            if surfaces and len(pts) >= 2:
                pts = _on_surfaces(pts, surfaces)
            curve = self._curve(pts, closed)
            mk = o["BRepBuilderAPI"]
            if curve is None:
                e = mk.BRepBuilderAPI_MakeEdge(self.vertex(key[0]), self.vertex(key[-1])).Edge()
            elif closed:
                v = self.vertex(key[0])
                e = mk.BRepBuilderAPI_MakeEdge(curve, v, v).Edge()
            else:
                e = mk.BRepBuilderAPI_MakeEdge(curve, self.vertex(key[0]), self.vertex(key[-1])).Edge()
            self.edges[key] = e
        e = self.edges[key]
        return self.o["TopoDS"].Edge_s(e.Reversed()) if reversed_ else e


def _on_surfaces(pts: np.ndarray, surfaces: tuple, per_segment: int = 4) -> np.ndarray:
    """Densify a boundary chain and project the samples onto its analytic surface(s).

    Between two surfaces the samples converge to their intersection curve; between two
    halves of one surface they land on that surface, so chords never cut through it.
    """
    dense = [pts[0]]
    for a, b in zip(pts[:-1], pts[1:]):
        for k in range(1, per_segment + 1):
            dense.append(a + (b - a) * k / per_segment)
    dense = np.array(dense)
    out = dense.copy()
    for i in range(1, len(dense) - 1):  # end points are snapped vertices already
        p = dense[i]
        for _ in range(40):
            previous = p
            for prim in surfaces:
                p = _project(prim, p)
            if np.linalg.norm(p - previous) < 1e-7:
                break
        if np.linalg.norm(p - dense[i]) < 1.0:
            out[i] = p
    return out


def _wire(bank: _EdgeBank, loop, pid: int, prims: list[dict] | None = None):
    o = bank.o
    mk = o["BRepBuilderAPI"].BRepBuilderAPI_MakeWire()
    for verts, neighbour in chains_of_loop(loop):
        if pid in bank.polyline or neighbour in bank.polyline:
            for a, b in zip(verts[:-1], verts[1:]):
                mk.Add(bank.segment(a, b))
        else:
            surfaces = ()
            if prims is not None:
                surfaces = tuple({id(q): q for q in (prims[pid], prims[neighbour] if neighbour >= 0 else prims[pid])
                                  if q["kind"] != FREE}.values())
            mk.Add(bank.edge(verts, surfaces))
    if not mk.IsDone():
        raise ValueError("wire construction failed")
    return mk.Wire()


def _ax3(origin, direction, away_from=None):
    o = _occ()
    gp = o["gp"]
    direction = np.asarray(direction, float)
    if away_from is not None:
        xdir = np.asarray(away_from, float)
        xdir = xdir - (xdir @ direction) * direction
        if np.linalg.norm(xdir) > 1e-9:
            xdir = -xdir / np.linalg.norm(xdir)
            return gp.gp_Ax3(gp.gp_Pnt(*map(float, origin)), gp.gp_Dir(*map(float, direction)), gp.gp_Dir(*map(float, xdir)))
    return gp.gp_Ax3(gp.gp_Pnt(*map(float, origin)), gp.gp_Dir(*map(float, direction)))


def _analytic_surface(prim: dict, centroid: np.ndarray, outward: np.ndarray):
    o = _occ()
    Geom = o["Geom"]
    if prim["kind"] == PLANE:
        n = prim["normal"] if prim["normal"] @ outward >= 0 else -prim["normal"]
        return Geom.Geom_Plane(_ax3(prim["point"], n))
    if prim["kind"] == CYLINDER:
        rel = centroid - prim["point"]
        ax = _ax3(prim["point"], prim["axis"], away_from=rel)
        return Geom.Geom_CylindricalSurface(ax, float(prim["radius"]))
    if prim["kind"] == CONE:
        h = float((centroid - prim["point"]) @ prim["axis"])
        origin = prim["point"] + h * prim["axis"]
        ax = _ax3(origin, prim["axis"], away_from=centroid - origin)
        return Geom.Geom_ConicalSurface(ax, float(prim["alpha"]), float(prim["radius"] + h * np.tan(prim["alpha"])))
    if prim["kind"] == SPHERE:
        rel = centroid - prim["centre"]
        axis = np.cross(rel, [0.0, 0.0, 1.0])
        if np.linalg.norm(axis) < 1e-9:
            axis = np.array([1.0, 0.0, 0.0])
        axis /= np.linalg.norm(axis)
        ax = _ax3(prim["centre"], axis, away_from=rel)
        return Geom.Geom_SphericalSurface(ax, float(prim["radius"]))
    raise ValueError(prim["kind"])


def _fix_face(face, tol: float):
    o = _occ()
    fixer = o["ShapeFix"].ShapeFix_Face(face)
    fixer.SetPrecision(tol)
    fixer.SetMaxTolerance(tol * 10)
    fixer.Perform()
    return fixer.Face()


def _surface_agrees(surface, mesh, faces) -> bool:
    """Whether the surface's own normal points like the mesh outward normal at the patch."""
    from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
    from OCP.GeomLProp import GeomLProp_SLProps
    from OCP.gp import gp_Pnt
    f = faces[int(np.argmax(mesh.area[faces]))]
    proj = GeomAPI_ProjectPointOnSurf(gp_Pnt(*map(float, mesh.centroid[f])), surface)
    u, v = proj.LowerDistanceParameters()
    props = GeomLProp_SLProps(surface, u, v, 1, 1e-9)
    n = props.Normal()
    return np.array([n.X(), n.Y(), n.Z()]) @ mesh.normal[f] >= 0


def _face_area(face) -> float:
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    return abs(props.Mass())


def _trimmed_face(surface, wires, loops, mesh, faces, tol):
    """Outer wire + holes as given (mesh orientation), trying both global orientations."""
    from OCP.BRepCheck import BRepCheck_Analyzer
    o = _occ()

    def extent(loop):
        pts = mesh.V[[e[0] for e in loop]]
        return float(np.linalg.norm(pts.max(0) - pts.min(0)))
    order = sorted(range(len(loops)), key=lambda i: -extent(loops[i]))
    target = float(mesh.area[faces].sum())
    best = None
    for flip in (False, True):
        ws = [o["TopoDS"].Wire_s(w.Reversed()) if flip else w for w in wires]
        mk = o["BRepBuilderAPI"].BRepBuilderAPI_MakeFace(surface, ws[order[0]], False)
        for i in order[1:]:
            mk.Add(ws[i])
        if not mk.IsDone():
            continue
        face = _fix_face(mk.Face(), tol)
        if not BRepCheck_Analyzer(face).IsValid():
            continue
        err = abs(_face_area(face) - target) / max(target, 1e-9)
        if best is None or err < best[0]:
            best = (err, face)
    return best


def _analytic_face(bank, prim, loops, mesh, faces, tol, pid):
    centroid = (mesh.centroid[faces] * mesh.area[faces, None]).sum(0) / mesh.area[faces].sum()
    outward = (mesh.normal[faces] * mesh.area[faces, None]).sum(0)
    surface = _analytic_surface(prim, centroid, outward)
    wires = [_wire(bank, loop, pid, bank.prims) for loop in loops]
    best = _trimmed_face(surface, wires, loops, mesh, faces, tol)
    if _AREA_LOG is not None and best is not None:
        _AREA_LOG.append((prim["kind"], len(faces), float(mesh.area[faces].sum()), best[0]))
    if best is None or best[0] > _AREA_LIMIT:
        raise ValueError("analytic face does not match its mesh patch")
    return _orient_like_mesh(best[1], mesh, faces)


def _freeform_limit(tol: float) -> float:
    """Largest vertex deviation accepted for a freeform B-spline (mesh chord error is ~0.3 mm)."""
    return max(0.3, 2.0 * tol)


TRIM_LIMIT_MM = 0.5


def _trim_limit(tol: float) -> float:
    """Largest edge/vertex tolerance a trimmed face may need before it is rebuilt from triangles."""
    return max(TRIM_LIMIT_MM, 2.0 * tol)


def _bspline_surface(points: np.ndarray, normal: np.ndarray, tol: float, edge: float | None = None):
    """Least-squares B-spline height field over the patch's best plane, returned in world coordinates."""
    from scipy.interpolate import griddata
    from OCP.GeomAPI import GeomAPI_PointsToBSplineSurface
    from OCP.TColStd import TColStd_Array2OfReal
    from OCP.GeomAbs import GeomAbs_C2
    from OCP.gp import gp_Ax3, gp_Pnt, gp_Dir, gp_Trsf

    centre = points.mean(axis=0)
    u_dir, v_dir = _orthonormal(normal)
    local = np.c_[(points - centre) @ u_dir, (points - centre) @ v_dir, (points - centre) @ normal]
    lo, hi = local[:, :2].min(0), local[:, :2].max(0)
    span = hi - lo
    margin = 0.05 * span.max() + 1e-6
    lo, hi = lo - margin, hi + margin
    if edge is None:
        edge = float(np.sqrt(span.prod() / max(len(points), 1)))
    # Grid finer than the mesh so the fit follows every vertex, capped for speed.
    nu = int(np.clip(1.5 * (hi[0] - lo[0]) / max(edge, 1e-6), 8, 70))
    nv = int(np.clip(1.5 * (hi[1] - lo[1]) / max(edge, 1e-6), 8, 70))
    gu, gv = np.meshgrid(np.linspace(lo[0], hi[0], nu), np.linspace(lo[1], hi[1], nv), indexing="ij")
    z = griddata(local[:, :2], local[:, 2], (gu, gv), method="linear")
    nearest = griddata(local[:, :2], local[:, 2], (gu, gv), method="nearest")
    z = np.where(np.isnan(z), nearest, z)
    zarr = TColStd_Array2OfReal(1, nu, 1, nv)
    for i in range(nu):
        for j in range(nv):
            zarr.SetValue(i + 1, j + 1, float(z[i, j]))
    du = (hi[0] - lo[0]) / (nu - 1)
    dv = (hi[1] - lo[1]) / (nv - 1)
    fit = GeomAPI_PointsToBSplineSurface()
    fit.Init(zarr, float(lo[0]), du, float(lo[1]), dv, 3, 8, GeomAbs_C2, tol * 0.25)
    if not fit.IsDone():
        raise ValueError("B-spline fit failed")
    surface = fit.Surface()
    # Height-field coordinates -> world.
    trsf = gp_Trsf()
    trsf.SetTransformation(gp_Ax3(gp_Pnt(*map(float, centre)), gp_Dir(*map(float, normal)), gp_Dir(*map(float, u_dir))), gp_Ax3())
    surface.Transform(trsf)
    # Deviation of the patch vertices from the fitted height field.
    heights = np.array([surface.Value(float(x), float(y)).Transformed(trsf.Inverted()).Z() for x, y in local[:, :2]])
    deviation = float(np.abs(heights - local[:, 2]).max())
    return surface, deviation


def _edge_length(mesh: Mesh, faces) -> float:
    tri = mesh.V[mesh.F[faces]]
    return float(np.median(np.linalg.norm(tri[:, 1] - tri[:, 0], axis=1)))


def refine_free_patches(mesh: Mesh, labels: np.ndarray, prims: list[dict], tol: float):
    """Split freeform patches until each one fits a single B-spline height field within tolerance."""
    labels = labels.copy()
    prims = list(prims)
    work = deque(i for i, p in enumerate(prims) if p["kind"] == FREE)
    while work:
        pid = work.popleft()
        faces = np.where(labels == pid)[0].tolist()
        if len(faces) < 6:
            continue
        pts = mesh.V[np.unique(mesh.F[faces])]
        normal = (mesh.normal[faces] * mesh.area[faces, None]).sum(0)
        normal /= np.linalg.norm(normal) + 1e-30
        try:
            _, deviation = _bspline_surface(pts, normal, tol, _edge_length(mesh, faces))
        except Exception:
            deviation = np.inf
        if deviation <= _freeform_limit(tol):
            continue
        pieces = [q for q in _split_by_normals(mesh, faces) if q]
        if len(pieces) < 2:
            pieces = [q for q in _split_in_two(mesh, faces) if q]
        if len(pieces) < 2:
            continue
        for piece in pieces[1:]:
            new = len(prims)
            prims.append({"kind": FREE})
            labels[piece] = new
            work.append(new)
        work.append(pid)
    return labels, prims


def _free_face(bank, loops, mesh, faces, tol, pid):
    pts = mesh.V[np.unique(mesh.F[faces])]
    normal = (mesh.normal[faces] * mesh.area[faces, None]).sum(0)
    normal /= np.linalg.norm(normal)
    surface, deviation = _bspline_surface(pts, normal, tol, _edge_length(mesh, faces))
    if deviation > _freeform_limit(tol):
        raise ValueError(f"B-spline deviates {deviation:.3f} mm from the mesh")
    wires = [_wire(bank, loop, pid, bank.prims) for loop in loops]
    best = _trimmed_face(surface, wires, loops, mesh, faces, tol)
    if _AREA_LOG is not None and best is not None:
        _AREA_LOG.append(("free", len(faces), float(mesh.area[faces].sum()), best[0]))
    if best is None or best[0] > _AREA_LIMIT:
        raise ValueError("B-spline face does not match its mesh patch")
    return _orient_like_mesh(best[1], mesh, faces)


def _orient_like_mesh(face, mesh, faces):
    """Flip a face so its normal agrees with the area-weighted mesh normal of its patch."""
    from OCP.BRepGProp import BRepGProp_Face
    from OCP.gp import gp_Pnt, gp_Vec
    from OCP.GeomAPI import GeomAPI_ProjectPointOnSurf
    from OCP.BRep import BRep_Tool
    from OCP.TopoDS import TopoDS
    surface = BRep_Tool.Surface_s(face)
    outward = (mesh.normal[faces] * mesh.area[faces, None]).sum(0)
    # Sample the face normal at the patch's largest triangle, projected onto the surface.
    f = faces[int(np.argmax(mesh.area[faces]))]
    proj = GeomAPI_ProjectPointOnSurf(gp_Pnt(*map(float, mesh.centroid[f])), surface)
    if proj.NbPoints() == 0:
        return face
    u, v = proj.LowerDistanceParameters()
    props = BRepGProp_Face(face)
    p, n = gp_Pnt(), gp_Vec()
    props.Normal(u, v, p, n)
    if np.array([n.X(), n.Y(), n.Z()]) @ mesh.normal[f] < 0:
        return TopoDS.Face_s(face.Reversed())
    return face


def _facet_faces(mesh, faces, bank):
    """Planar triangle faces on the bank's shared vertices and straight edges."""
    o = _occ()
    out = []
    for f in faces:
        a, b, c = (int(x) for x in mesh.F[f])
        mk = o["BRepBuilderAPI"].BRepBuilderAPI_MakeWire(bank.segment(a, b), bank.segment(b, c), bank.segment(c, a))
        face = o["BRepBuilderAPI"].BRepBuilderAPI_MakeFace(mk.Wire(), True)
        if not face.IsDone():
            raise ValueError(f"degenerate triangle {f} cannot become a face")
        out.append(face.Face())
    return out


def _max_tolerance(face) -> float:
    from OCP.BRep import BRep_Tool
    from OCP.TopAbs import TopAbs_EDGE, TopAbs_VERTEX
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS
    worst = 0.0
    for kind, cast in ((TopAbs_EDGE, TopoDS.Edge_s), (TopAbs_VERTEX, TopoDS.Vertex_s)):
        explorer = TopExp_Explorer(face, kind)
        while explorer.More():
            worst = max(worst, BRep_Tool.Tolerance_s(cast(explorer.Current())))
            explorer.Next()
    return worst


def _build_faces(mesh, labels, prims, tol, polyline, trace):
    """One build pass; returns faces, per-kind counts and the patches that could not be fitted.

    Triangle patches are built first: ShapeFix on smooth faces raises the tolerance of
    shared vertices in place, after which tiny triangles can no longer be closed.
    A smooth face that fails is reported, not patched here; the next pass rebuilds it
    from triangles on a fresh edge bank.
    """
    bank = _EdgeBank(mesh, polyline, prims)
    built, counts, failed = [], defaultdict(int), set()
    for pid in sorted(polyline):
        fs = np.where(labels == pid)[0]
        if len(fs):
            built.extend(_facet_faces(mesh, fs, bank))
    for pid, prim in enumerate(prims):
        fs = np.where(labels == pid)[0]
        if not len(fs) or pid in polyline:
            continue
        loops = patch_loops(mesh, labels, pid)
        if trace is not None:
            trace.write_text(f"{pid} {prim['kind']} {len(fs)}")
        try:
            if prim["kind"] == FREE:
                face = _free_face(bank, loops, mesh, fs, tol, pid)
            else:
                face = _analytic_face(bank, prim, loops, mesh, fs, tol, pid)
            # A face whose trimming needed a loose tolerance is not accurate enough.
            if _max_tolerance(face) > _trim_limit(tol):
                raise ValueError("face trimming tolerance too large")
            built.append(face)
            counts[prim["kind"]] += 1
        except Exception as exc:
            failed.add(pid)
            if _DEBUG is not None:
                _DEBUG.append((pid, prim["kind"], len(fs), str(exc)[:120]))
    return built, counts, failed


class _PatchLocator:
    """Map points of the built solid back to the patches whose mesh vertices they sit on."""

    def __init__(self, mesh, labels):
        from scipy.spatial import cKDTree

        self.tree = cKDTree(mesh.V)
        self.pids = [set() for _ in range(len(mesh.V))]
        for f, pid in zip(mesh.F, labels):
            for v in f:
                self.pids[int(v)].add(int(pid))

    def at(self, points) -> set[int]:
        """Patches touching every point (all sides of an edge or one face), else any of them."""
        if not len(points):
            return set()
        _, idx = self.tree.query(np.asarray(points, dtype=float))
        sets = [self.pids[int(i)] for i in np.atleast_1d(idx)]
        common = set.intersection(*sets)
        return common or set().union(*sets)

    def of_shape(self, shape) -> set[int]:
        from OCP.BRep import BRep_Tool
        from OCP.TopAbs import TopAbs_VERTEX
        from OCP.TopExp import TopExp_Explorer
        from OCP.TopoDS import TopoDS

        points = []
        explorer = TopExp_Explorer(shape, TopAbs_VERTEX)
        while explorer.More():
            p = BRep_Tool.Pnt_s(TopoDS.Vertex_s(explorer.Current()))
            points.append((p.X(), p.Y(), p.Z()))
            explorer.Next()
        return self.at(points)


def _invalid_face_pids(shape, locate) -> set[int]:
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.TopAbs import TopAbs_FACE
    from OCP.TopExp import TopExp_Explorer

    analyzer = BRepCheck_Analyzer(shape)
    if analyzer.IsValid():
        return set()
    bad = set()
    explorer = TopExp_Explorer(shape, TopAbs_FACE)
    while explorer.More():
        result = analyzer.Result(explorer.Current())
        if result is not None and any(int(status) != 0 for status in result.Status()):
            bad |= locate.of_shape(explorer.Current())
        explorer.Next()
    # Invalid without a bad face (shell or solid level): no patch to blame, report all as unknown.
    return bad or {-1}


def _count(shape, kind) -> int:
    from OCP.TopExp import TopExp_Explorer

    explorer = TopExp_Explorer(shape, kind)
    n = 0
    while explorer.More():
        n += 1
        explorer.Next()
    return n


def _assemble_solids(built, tol_mm, locate):
    """Sew faces into one solid per closed shell; return (shape, shells, patches to rebuild)."""
    from OCP.BRep import BRep_Builder
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid, BRepBuilderAPI_Sewing
    from OCP.ShapeFix import ShapeFix_Shape, ShapeFix_Shell, ShapeFix_Solid
    from OCP.TopAbs import TopAbs_SHELL, TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopoDS import TopoDS, TopoDS_Compound

    sewing = BRepBuilderAPI_Sewing(tol_mm * 2, True, True, True, False)
    for face in built:
        sewing.Add(face)
    sewing.Perform()
    # The mesh is closed, so any free edge is a seam two faces failed to share.
    failed = set()
    for i in range(1, sewing.NbFreeEdges() + 1):
        failed |= locate.of_shape(sewing.FreeEdge(i))
    if failed:
        return None, 0, failed
    sewn = sewing.SewedShape()
    explorer = TopExp_Explorer(sewn, TopAbs_SHELL)
    if not explorer.More():
        raise ValueError("smooth faces did not sew into a shell")
    # A link may consist of several separate closed bodies: one solid per shell.
    builder = BRep_Builder()
    solid = TopoDS_Compound()
    builder.MakeCompound(solid)
    shells = 0
    while explorer.More():
        fix = ShapeFix_Shell(TopoDS.Shell_s(explorer.Current()))
        fix.Perform()
        solid_fix = ShapeFix_Solid()
        solid_fix.Init(BRepBuilderAPI_MakeSolid(fix.Shell()).Solid())
        solid_fix.Perform()
        builder.Add(solid, solid_fix.Solid())
        shells += 1
        explorer.Next()
    shape_fix = ShapeFix_Shape(solid)
    shape_fix.SetPrecision(tol_mm * 0.1)
    shape_fix.SetMaxTolerance(_trim_limit(tol_mm))
    shape_fix.Perform()
    solid = shape_fix.Shape()
    failed = _invalid_face_pids(solid, locate)
    if not failed and _count(solid, TopAbs_SOLID) != shells:
        failed = {-1}
    return solid, shells, failed


def _step_round_trip_failures(shape, shells, locate) -> set[int]:
    """Write the shape to STEP, read it back, and return patches whose faces did not survive."""
    import os
    import tempfile

    from OCP.IFSelect import IFSelect_RetDone
    from OCP.STEPControl import STEPControl_AsIs, STEPControl_Reader, STEPControl_Writer
    from OCP.TopAbs import TopAbs_SOLID

    handle, path = tempfile.mkstemp(suffix=".step", prefix="raed-roundtrip-")
    os.close(handle)
    try:
        writer = STEPControl_Writer()
        if writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone or writer.Write(path) != IFSelect_RetDone:
            return {-1}
        reader = STEPControl_Reader()
        if reader.ReadFile(path) != IFSelect_RetDone:
            return {-1}
        reader.TransferRoots()
        back = reader.OneShape()
    finally:
        os.unlink(path)
    failed = _invalid_face_pids(back, locate)
    if not failed and _count(back, TopAbs_SOLID) != shells:
        failed = {-1}
    return failed


def smooth_solid(vertices_mm: np.ndarray, faces: np.ndarray, *, tol_mm: float = 0.25, part_name: str = "part",
                 skip: frozenset[int] = frozenset(), trace=None):
    """Return (solid, report) for a closed, consistently oriented triangle mesh in millimetres."""
    import time

    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps

    started = time.time()
    vertices_mm, faces, cleanup = clean_mesh(vertices_mm, faces)
    mesh = Mesh(vertices_mm, faces)
    labels, prims = segment(mesh, tol_mm)
    labels, prims = merge_facet_strips(mesh, labels, prims, tol_mm)
    labels = absorb_slivers(mesh, labels, prims, tol_mm)
    labels, prims = demote_small_primitives(mesh, labels, prims)
    prims = promote_free_regions(mesh, labels, prims, tol_mm)
    labels, prims = split_patches(mesh, labels, prims)
    labels, prims = refine_free_patches(mesh, labels, prims, tol_mm)
    # Snap shared vertices onto surface intersections; the solid is built on the snapped mesh.
    snapped, snapped_count = snap_boundary_vertices(mesh, labels, prims, tol_mm)
    mesh_volume = float(np.einsum("ij,ij->i", mesh.V[mesh.F[:, 0]], np.cross(mesh.V[mesh.F[:, 1]], mesh.V[mesh.F[:, 2]])).sum() / 6)
    mesh = Mesh(snapped, mesh.F)
    segmented_s = time.time() - started
    passes = 0
    counts_by_pid = np.bincount(labels, minlength=len(prims))
    locate = _PatchLocator(mesh, labels)
    # Crash-isolated patches and crease slivers (1-3 triangles) keep their exact triangles.
    polyline = set(skip) | {pid for pid, p in enumerate(prims) if p["kind"] == FREE and 0 < counts_by_pid[pid] <= 3}
    for _ in range(8):
        if _DEBUG is not None:
            _DEBUG.append(("PASS", passes + 1, 0, ""))
        built, counts, failed = _build_faces(mesh, labels, prims, tol_mm, frozenset(polyline), trace)
        passes += 1
        if not failed:
            solid, shells, failed = _assemble_solids(built, tol_mm, locate)
            if not failed:
                # What a CAD system reads is the STEP file, not this in-memory shape.
                failed = _step_round_trip_failures(solid, shells, locate)
            if not failed:
                break
            if -1 in failed:
                raise ValueError(f"{part_name}: solid is invalid at shell level")
            if not failed - polyline:
                raise ValueError(f"{part_name}: defect on an exact-triangle region cannot be rebuilt")
            failed -= polyline
        # Rebuild with failed patches as triangles; their neighbours then share polyline edges.
        polyline |= failed
    if failed:
        raise ValueError(f"{part_name}: {len(failed)} patches still failing after rebuild passes")
    fallbacks = defaultdict(int)
    for pid in polyline:
        if counts_by_pid[pid]:
            fallbacks[prims[pid]["kind"]] += 1
    valid = BRepCheck_Analyzer(solid).IsValid()
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(solid, props)
    report = {
        "method": "segmented_primitives_and_nurbs_plates",
        "valid": bool(valid),
        "source_triangles": int(len(mesh.F)),
        "faces": dict(counts),
        "faceted_fallback_patches": dict(fallbacks),
        "volume_mm3": float(props.Mass()),
        "mesh_volume_mm3": mesh_volume,
        "volume_error_pct": float(100 * (props.Mass() - mesh_volume) / mesh_volume) if mesh_volume else None,
        "tolerance_mm": tol_mm,
        "mesh_cleanup": cleanup,
        "bodies": shells,
        "snapped_vertices": snapped_count,
        "max_tolerance_mm": round(_max_tolerance(solid), 4),
        "smooth_area_pct": round(100 * float(mesh.area[~np.isin(labels, list(polyline))].sum()) / float(mesh.area.sum()), 1),
        "seconds": round(time.time() - started, 1),
        "segmentation_seconds": round(segmented_s, 1),
        "build_passes": passes,
    }
    return solid, report
