"""meshlite: offline mesh toolkit for DFM / reverse engineering. numpy only (scipy and Pillow optional).

Works in a sandbox with no internet (no trimesh / shapely / vtk / build123d / OCC). Input is a mesh
(binary or ASCII STL). A STEP file cannot be tessellated without OCC: ask the user to export an STL from
their CAD (chord tolerance <= 0.01 mm, angle <= 5 deg).

Main API
    m = Mesh.load("part.stl")                  # merged vertices, normals, areas
    m.stats()                                  # bbox, volume, area, watertight, euler
    m.draft_deg(pull)                          # per-face draft to the pull axis
    m.subdivide(max_edge)                      # finer faces for area-accurate checks
    undercut_mask(m, axis=1)                   # straight-pull undercut faces (pull along +/- axis)
    thickness_axis(m, n) / steel_axis(m, n)    # wall / steel thickness (axis rays, cosine-corrected)
    projected_area(m, axis=1)                  # silhouette area along the pull
    parting_edges(m, cls)                      # edges between cavity- and core-side faces
    geodesic(m, point)                         # flow-length proxy from a gate point
    section(m, origin, normal)                 # planar section -> list of polylines (Nx3)
    point_mesh_distance(m, pts)                # exact point-to-triangle distance (needs scipy)
    render(m, face_rgb, out, view=...)         # shaded PNG (painter's algorithm) + world->pixel projector
"""

from __future__ import annotations

import heapq
import re
import struct
from pathlib import Path

import numpy as np

EPS = 1e-3


# ============================================================ mesh
class Mesh:
    def __init__(self, V, F):
        self.V = np.asarray(V, float)
        self.F = np.asarray(F, np.int64)
        self._update()

    def _update(self):
        T = self.V[self.F]
        c = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
        a = np.linalg.norm(c, axis=1)
        self.area = a / 2
        self.N = c / np.maximum(a, 1e-18)[:, None]
        self.C = T.mean(1)
        self.T = T

    # ---------------------------------------------------------------- io
    @classmethod
    def load(cls, path, digits=5):
        data = Path(path).read_bytes()
        n = struct.unpack("<I", data[80:84])[0] if len(data) >= 84 else 0
        if len(data) == 84 + 50 * n and n > 0:
            dt = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
            tri = np.frombuffer(data, dt, count=n, offset=84)["v"].astype(float)
        else:
            txt = data.decode("latin-1")
            nums = re.findall(r"vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)", txt)
            tri = np.array(nums, float).reshape(-1, 3, 3)
        P = tri.reshape(-1, 3)
        key = np.round(P, digits)
        uniq, inv = np.unique(key, axis=0, return_inverse=True)
        F = inv.reshape(-1, 3)
        F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
        return cls(uniq, F)

    def save_stl(self, path):
        with open(path, "wb") as f:
            f.write(b"meshlite".ljust(80, b" "))
            f.write(struct.pack("<I", len(self.F)))
            rec = np.zeros(len(self.F), np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
            rec["n"] = self.N
            rec["v"] = self.T
            f.write(rec.tobytes())

    # ---------------------------------------------------------------- topology
    def edges(self):
        """(unique edges Ex2, face count per edge, edge->faces index arrays)."""
        e = np.sort(np.concatenate([self.F[:, [0, 1]], self.F[:, [1, 2]], self.F[:, [2, 0]]]), axis=1)
        fid = np.tile(np.arange(len(self.F)), 3)
        uniq, inv, cnt = np.unique(e, axis=0, return_inverse=True, return_counts=True)
        return uniq, cnt, inv.ravel(), fid

    def stats(self):
        v = float(np.einsum("ij,ij->i", self.T[:, 0], np.cross(self.T[:, 1], self.T[:, 2])).sum() / 6)
        _, cnt, _, _ = self.edges()
        lo, hi = self.V.min(0), self.V.max(0)
        E = len(cnt)
        return {"faces": int(len(self.F)), "vertices": int(len(self.V)), "volume_mm3": round(abs(v), 3),
                "area_mm2": round(float(self.area.sum()), 3), "bbox_min": np.round(lo, 3).tolist(),
                "bbox_max": np.round(hi, 3).tolist(), "size": np.round(hi - lo, 3).tolist(),
                "watertight": bool((cnt == 2).all()), "euler": int(len(self.V) - E + len(self.F))}

    def draft_deg(self, pull=(0, 1, 0)):
        p = np.asarray(pull, float) / np.linalg.norm(pull)
        return np.degrees(np.arcsin(np.clip(np.abs(self.N @ p), 0, 1)))

    def subdivide(self, max_edge=1.2, max_iter=40):
        """Longest-edge bisection until every edge <= max_edge. Long CAD slivers become a row of pieces instead
        of 4^k tiny ones. Neighbours get T-junctions: fine for face-wise checks, not for topology (use the
        original mesh for edges, geodesics and components)."""
        V, F = self.V.copy(), self.F.copy()
        for _ in range(max_iter):
            T = V[F]
            L = np.stack([np.linalg.norm(T[:, 1] - T[:, 0], axis=1), np.linalg.norm(T[:, 2] - T[:, 1], axis=1),
                          np.linalg.norm(T[:, 0] - T[:, 2], axis=1)], 1)
            k = L.argmax(1)
            big = L[np.arange(len(F)), k] > max_edge
            if not big.any():
                break
            Fb, kb = F[big], k[big]
            a = Fb[np.arange(len(Fb)), kb]
            b = Fb[np.arange(len(Fb)), (kb + 1) % 3]
            c = Fb[np.arange(len(Fb)), (kb + 2) % 3]
            mid = np.arange(len(V), len(V) + len(Fb))
            V = np.vstack([V, (V[a] + V[b]) / 2])
            F = np.vstack([F[~big], np.c_[a, mid, c], np.c_[mid, b, c]])
        return Mesh(V, F)

    def sample(self, n, seed=0):
        rng = np.random.default_rng(seed)
        fi = rng.choice(len(self.F), n, p=self.area / self.area.sum())
        r1, r2 = rng.random(n), rng.random(n)
        s = np.sqrt(r1)
        T = self.T[fi]
        P = (1 - s)[:, None] * T[:, 0] + (s * (1 - r2))[:, None] * T[:, 1] + (s * r2)[:, None] * T[:, 2]
        return P, fi


# ============================================================ axis-aligned ray caster (uniform 2-D grid)
class AxisCaster:
    """Ray casting along +/- one world axis. Triangles are binned on the perpendicular plane (uniform grid);
    queries are expanded to (ray, candidate triangle) pairs and solved in vectorised chunks."""

    def __init__(self, m: Mesh, axis: int, cell=None):
        self.m, self.axis = m, axis
        self.uv = [i for i in range(3) if i != axis]
        T2 = m.T[:, :, self.uv]
        lo, hi = T2.min(1), T2.max(1)
        self.o = lo.min(0) - 1e-6
        ext = hi.max(0) - self.o
        if cell is None:
            cell = max(float(np.sqrt(ext[0] * ext[1] / max(len(m.F), 1)) * 1.5), 0.05)
        self.cell = cell
        self.n = np.maximum(np.ceil(ext / cell).astype(np.int64) + 1, 1)
        i0 = np.floor((lo - self.o) / cell).astype(np.int64)
        i1 = np.floor((hi - self.o) / cell).astype(np.int64)
        sx, sy = i1[:, 0] - i0[:, 0] + 1, i1[:, 1] - i0[:, 1] + 1
        cnt = sx * sy
        tri = np.repeat(np.arange(len(m.F)), cnt)
        loc = np.arange(cnt.sum()) - np.repeat(np.cumsum(cnt) - cnt, cnt)
        syr = np.repeat(sy, cnt)
        cells = (i0[tri, 0] + loc // syr) * self.n[1] + (i0[tri, 1] + loc % syr)
        order = np.argsort(cells, kind="stable")
        self.cells, self.tris = cells[order], tri[order]
        self.starts = np.searchsorted(self.cells, np.arange(self.n[0] * self.n[1] + 1))
        A = T2[:, 0]
        self.A = A
        self.v0, self.v1 = T2[:, 1] - A, T2[:, 2] - A
        d00 = (self.v0 ** 2).sum(1)
        d01 = (self.v0 * self.v1).sum(1)
        d11 = (self.v1 ** 2).sum(1)
        den = d00 * d11 - d01 * d01
        self.ok = np.abs(den) > 1e-14
        self.den = np.where(self.ok, den, 1.0)
        self.d00, self.d01, self.d11 = d00, d01, d11
        self.h = m.T[:, :, axis]

    def first_hit(self, origins, sign, max_dist=np.inf, chunk_pairs=3_000_000):
        """Distance along sign*axis to the first triangle; inf if none."""
        P = np.atleast_2d(np.asarray(origins, float))
        out = np.full(len(P), np.inf)
        if not len(P):
            return out
        uv = P[:, self.uv]
        ij = np.floor((uv - self.o) / self.cell).astype(np.int64)
        inside = (ij >= 0).all(1) & (ij < self.n).all(1)
        cid = np.where(inside, ij[:, 0] * self.n[1] + ij[:, 1], 0)
        a, b = self.starts[cid], self.starts[cid + 1]
        cnt = np.where(inside, b - a, 0)
        q_all = np.flatnonzero(cnt > 0)
        csum = np.cumsum(cnt[q_all])
        s0 = 0
        while s0 < len(q_all):
            base = csum[s0 - 1] if s0 else 0
            s1 = max(int(np.searchsorted(csum, base + chunk_pairs, side="right")), s0 + 1)
            q = q_all[s0:s1]
            c = cnt[q]
            qi = np.repeat(q, c)
            loc = np.arange(c.sum()) - np.repeat(np.cumsum(c) - c, c)
            t = self.tris[np.repeat(a[q], c) + loc]
            v2 = uv[qi] - self.A[t]
            d20 = (v2 * self.v0[t]).sum(1)
            d21 = (v2 * self.v1[t]).sum(1)
            den = self.den[t]
            b1 = (self.d11[t] * d20 - self.d01[t] * d21) / den
            b2 = (self.d00[t] * d21 - self.d01[t] * d20) / den
            b0 = 1 - b1 - b2
            tol = -1e-9
            hit = self.ok[t] & (b0 >= tol) & (b1 >= tol) & (b2 >= tol)
            H = self.h[t]
            z = b0 * H[:, 0] + b1 * H[:, 1] + b2 * H[:, 2]
            d = (z - P[qi, self.axis]) * sign
            d = np.where(hit & (d > 1e-7) & (d <= max_dist), d, np.inf)
            np.minimum.at(out, qi, d)
            s0 = s1
        return out


# ============================================================ DFM checks
def undercut_mask(m: Mesh, axis=1, zero_draft_deg=0.25, caster=None):
    """Faces that cannot release along their own side of the pull (same rule as the full pipeline)."""
    cs = caster or AxisCaster(m, axis)
    ny = m.N[:, axis]
    vert = np.abs(ny) < np.sin(np.radians(zero_draft_deg))
    up, dn = (ny > 1e-3), (ny < -1e-3)
    o = m.C + EPS * m.N
    blocked = np.zeros(len(m.F), bool)
    blocked[up] = np.isfinite(cs.first_hit(o[up], +1))
    blocked[dn] = np.isfinite(cs.first_hit(o[dn], -1))
    vi = np.flatnonzero(vert)
    blocked[vi] = np.isfinite(cs.first_hit(o[vi], +1)) & np.isfinite(cs.first_hit(o[vi], -1))
    return blocked


def _axis_rays(m, n_samples, outward, casters, seed):
    P, fi = m.sample(n_samples, seed)
    N = m.N[fi]
    k = np.argmax(np.abs(N), 1)
    res = np.full(len(P), np.inf)
    for ax in range(3):
        sel = np.flatnonzero(k == ax)
        if not len(sel):
            continue
        s = np.sign(N[sel, ax]) * (1 if outward else -1)
        o = P[sel] + EPS * N[sel] * (1 if outward else -1)
        for sg in (+1, -1):
            g = sel[s == sg]
            if len(g):
                d = casters[ax].first_hit(o[s == sg], sg)
                res[g] = d * np.abs(N[g, ax])  # cosine-correct to the local normal
    return P, fi, res


def thickness_axis(m, n_samples=30000, casters=None, seed=1):
    """Wall thickness at surface samples: axis ray through the part, corrected by the normal's cosine.
    Approximation (exact on walls square to an axis). Returns (points, face idx, thickness)."""
    cs = casters or [AxisCaster(m, a) for a in range(3)]
    return _axis_rays(m, n_samples, False, cs, seed)


def steel_axis(m, n_samples=30000, casters=None, seed=2):
    """Air gap (steel thickness) in front of each surface sample; inf where the ray leaves the part."""
    cs = casters or [AxisCaster(m, a) for a in range(3)]
    return _axis_rays(m, n_samples, True, cs, seed)


def _dirs26():
    d = np.array([(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if (i, j, k) != (0, 0, 0)], float)
    return d / np.linalg.norm(d, axis=1)[:, None]


def _frame_to_z(d):
    """Rotation matrix R with R @ d = +Z."""
    d = np.asarray(d, float) / np.linalg.norm(d)
    a = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
    x = np.cross(a, d)
    x /= np.linalg.norm(x)
    y = np.cross(d, x)
    return np.stack([x, y, d])


def ray_gap(m, P, D, dirs=None, cos_min=0.85):
    """Distance from points P along unit directions D to the mesh (inf = escapes). Each ray is snapped to the
    nearest of 26 fixed directions (axes, face and cube diagonals, <= 22.5 deg away) and the distance is
    corrected by the cosine to the true direction. Exact for rays on those directions."""
    dirs = _dirs26() if dirs is None else dirs
    D = np.asarray(D, float)
    k = np.argmax(D @ dirs.T, 1)
    out = np.full(len(P), np.inf)
    for i in np.unique(k):
        sel = np.flatnonzero(k == i)
        R = _frame_to_z(dirs[i])
        mr = Mesh(m.V @ R.T, m.F)
        cs = AxisCaster(mr, 2)
        o = (P[sel] + EPS * D[sel]) @ R.T
        c = np.clip(D[sel] @ dirs[i], 0, 1)
        d = cs.first_hit(o, +1)
        out[sel] = np.where(c >= cos_min, d * c, d)
    return out


def projected_area(m, axis=1, step=0.25):
    cs = AxisCaster(m, axis)
    lo, hi = m.V.min(0), m.V.max(0)
    u, v = cs.uv
    U, W = np.meshgrid(np.arange(lo[u], hi[u], step) + step / 2, np.arange(lo[v], hi[v], step) + step / 2)
    P = np.zeros((U.size, 3))
    P[:, u], P[:, v], P[:, axis] = U.ravel(), W.ravel(), hi[axis] + 5
    return float(np.isfinite(cs.first_hit(P, -1)).sum() * step * step)


def parting_edges(m, cls):
    """Mesh edges shared by a class-0 (cavity) face and a class-1 (core) face. cls: 0/1/2 per face."""
    e, cnt, inv, fid = m.edges()
    pairs = {}
    for ei, f in zip(inv, fid):
        pairs.setdefault(ei, []).append(f)
    segs = []
    for ei, fs in pairs.items():
        if len(fs) == 2:
            a, b = cls[fs[0]], cls[fs[1]]
            if a != b and a < 2 and b < 2:
                segs.append(m.V[e[ei]])
    return np.array(segs)


def geodesic(m, point):
    """Shortest path length over mesh edges from the vertex nearest `point` (flow-length proxy)."""
    e, _, _, _ = m.edges()
    w = np.linalg.norm(m.V[e[:, 0]] - m.V[e[:, 1]], axis=1)
    src = int(np.argmin(np.linalg.norm(m.V - np.asarray(point), axis=1)))
    try:
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import dijkstra

        n = len(m.V)
        g = coo_matrix((np.r_[w, w], (np.r_[e[:, 0], e[:, 1]], np.r_[e[:, 1], e[:, 0]])), shape=(n, n)).tocsr()
        return dijkstra(g, indices=src)
    except ImportError:
        adj = [[] for _ in range(len(m.V))]
        for (a, b), ww in zip(e, w):
            adj[a].append((b, ww))
            adj[b].append((a, ww))
        dist = np.full(len(m.V), np.inf)
        dist[src] = 0.0
        h = [(0.0, src)]
        while h:
            d, u = heapq.heappop(h)
            if d > dist[u]:
                continue
            for v, ww in adj[u]:
                nd = d + ww
                if nd < dist[v]:
                    dist[v] = nd
                    heapq.heappush(h, (nd, v))
        return dist


def section(m, origin, normal):
    """Planar section -> list of polylines (each Nx3; closed loops repeat the first point).
    Segments are chained through the mesh edges they cross, so loops close exactly."""
    n = np.asarray(normal, float) / np.linalg.norm(normal)
    d = (m.V - np.asarray(origin, float)) @ n
    d = np.where(np.abs(d) < 1e-9, 1e-9, d)  # no vertex exactly on the plane
    D = d[m.F]
    pos = D > 0
    cross = pos.any(1) & ~pos.all(1)
    segs = []  # (edge key a, edge key b)
    pts = {}
    for f, dd in zip(m.F[cross], D[cross]):
        ks = []
        for i, j in ((0, 1), (1, 2), (2, 0)):
            if (dd[i] > 0) != (dd[j] > 0):
                a, b = (f[i], f[j]) if f[i] < f[j] else (f[j], f[i])
                if (a, b) not in pts:
                    t = d[a] / (d[a] - d[b])
                    pts[(a, b)] = m.V[a] + t * (m.V[b] - m.V[a])
                ks.append((a, b))
        if len(ks) == 2:
            segs.append(ks)
    nb = {}
    for i, (a, b) in enumerate(segs):
        nb.setdefault(a, []).append(i)
        nb.setdefault(b, []).append(i)
    used = np.zeros(len(segs), bool)
    lines = []
    for i in range(len(segs)):
        if used[i]:
            continue
        used[i] = True
        chain = [segs[i][0], segs[i][1]]
        while True:
            nxt = [j for j in nb.get(chain[-1], []) if not used[j]]
            if not nxt:
                break
            j = nxt[0]
            used[j] = True
            chain.append(segs[j][1] if segs[j][0] == chain[-1] else segs[j][0])
        lines.append(np.array([pts[k] for k in chain]))
    return lines


def point_mesh_distance(m, pts, k=16, max_edge=0.8):
    """Exact distance from points to the mesh surface. The mesh is first bisected to edges <= max_edge so the
    true nearest triangle is among the k nearest centroids (CAD STLs have long slivers). Needs scipy."""
    return closest_point(m.subdivide(max_edge), pts, k=k)[1]


def closest_point(m, pts, k=16, tree=None):
    """Exact closest point on the mesh (k nearest face centroids checked; use a mesh with short edges,
    e.g. m.subdivide(2.0), so the right face is among them). Needs scipy. Returns (points, distances)."""
    from scipy.spatial import cKDTree

    tree = tree or cKDTree(m.C)
    _, idx = tree.query(pts, k=min(k, len(m.F)))
    best = np.full(len(pts), np.inf)
    bq = np.zeros((len(pts), 3))
    for j in range(idx.shape[1]):
        T = m.T[idx[:, j]]
        d, q = _pt_tri(pts, T[:, 0], T[:, 1], T[:, 2], True)
        better = d < best
        best[better], bq[better] = d[better], q[better]
    return bq, best


def _pt_tri(p, a, b, c, return_point=False):
    """Vectorised point-triangle distance (Ericson, Real-Time Collision Detection 5.1.5)."""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = p - b
    d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = p - c
    d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    den = va + vb + vc
    den = np.where(np.abs(den) < 1e-18, 1e-18, den)
    v, w = vb / den, vc / den
    q = a + ab * v[:, None] + ac * w[:, None]
    # region tests
    r = np.full(len(p), -1)
    r[(d1 <= 0) & (d2 <= 0)] = 0
    r[(r < 0) & (d3 >= 0) & (d4 <= d3)] = 1
    r[(r < 0) & (d6 >= 0) & (d5 <= d6)] = 2
    m_ab = (r < 0) & (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    m_ac = (r < 0) & (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    m_bc = (r < 0) & (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    q[r == 0] = a[r == 0]
    q[r == 1] = b[r == 1]
    q[r == 2] = c[r == 2]
    t = d1 / np.where(np.abs(d1 - d3) < 1e-18, 1e-18, d1 - d3)
    q[m_ab] = (a + ab * t[:, None])[m_ab]
    t = d2 / np.where(np.abs(d2 - d6) < 1e-18, 1e-18, d2 - d6)
    q[m_ac & ~m_ab] = (a + ac * t[:, None])[m_ac & ~m_ab]
    t = (d4 - d3) / np.where(np.abs((d4 - d3) + (d5 - d6)) < 1e-18, 1e-18, (d4 - d3) + (d5 - d6))
    sel = m_bc & ~m_ab & ~m_ac
    q[sel] = (b + (c - b) * t[:, None])[sel]
    if return_point:
        return np.linalg.norm(p - q, axis=1), q
    return np.linalg.norm(p - q, axis=1)


# ============================================================ more checks (thickness, clusters, flow proxies)
def sphere_thickness(m, n_samples=30000, rmax=4.0, iters=20, seed=3, side=1):
    """Wall thickness = inscribed-sphere diameter (shrinking-ball method against the exact triangles).
    side=1: inside the part (wall thickness); side=-1: outside (steel / air). Needs scipy.
    Pass a mesh with short edges (m.subdivide(2.0)). Returns (points, face idx, diameter mm)."""
    from scipy.spatial import cKDTree

    tree = cKDTree(m.C)
    P, fi = m.sample(n_samples, seed)
    N = m.N[fi] * side
    r = np.full(len(P), rmax)
    active = np.ones(len(P), bool)
    for _ in range(iters):
        idx = np.flatnonzero(active)
        if not len(idx):
            break
        c = P[idx] - r[idx, None] * N[idx]
        q, dist = closest_point(m, c, tree=tree)
        done = dist >= r[idx] * (1 - 1e-4) - 1e-6
        dq = P[idx] - q
        den = 2 * (dq * N[idx]).sum(1)
        rn = np.where(den > 1e-12, (dq * dq).sum(1) / np.maximum(den, 1e-12), r[idx])
        grow = ~done & (rn < r[idx] * (1 - 1e-5))
        r[idx[grow]] = rn[grow]
        active[idx[~grow]] = False
    return P, fi, 2 * r


def local_max(points, values, radius=0.7):
    """Max of `values` within `radius` (removes the edge dip of the shrinking ball at wall corners). Needs scipy."""
    from scipy.spatial import cKDTree

    t = cKDTree(points)
    out = values.copy()
    for i, nb in enumerate(t.query_ball_point(points, radius)):
        out[i] = values[nb].max()
    return out


def face_adjacency(m):
    """(pairs Kx2 of faces sharing an edge, shared edge vertex ids Kx2)."""
    e, cnt, inv, fid = m.edges()
    order = np.argsort(inv, kind="stable")
    ei, ff = inv[order], fid[order]
    first = np.r_[True, ei[1:] != ei[:-1]]
    starts = np.flatnonzero(first)
    two = np.flatnonzero(cnt[ei[starts]] == 2)
    a, b = ff[starts[two]], ff[starts[two] + 1]
    return np.c_[a, b], e[ei[starts[two]]]


def face_clusters(m, mask, adj=None):
    """Connected groups of flagged faces -> list of face-index arrays, largest area first."""
    idx = np.flatnonzero(mask)
    if not len(idx):
        return []
    pairs = (adj if adj is not None else face_adjacency(m))[0]
    keep = mask[pairs[:, 0]] & mask[pairs[:, 1]]
    parent = np.arange(len(m.F))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in pairs[keep]:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    roots = np.array([find(i) for i in idx])
    groups = [idx[roots == r] for r in np.unique(roots)]
    return sorted(groups, key=lambda g: -m.area[g].sum())


def point_clusters(pts, radius=3.0):
    """Greedy grouping of points closer than `radius` (chained) -> list of index arrays, largest first."""
    pts = np.asarray(pts, float)
    if not len(pts):
        return []
    k = np.floor(pts / radius).astype(int)
    cell = {}
    for i, key in enumerate(map(tuple, k)):
        cell.setdefault(key, []).append(i)
    lab = np.full(len(pts), -1)
    cur = 0
    for s in range(len(pts)):
        if lab[s] >= 0:
            continue
        lab[s] = cur
        stack = [s]
        while stack:
            i = stack.pop()
            ci = k[i]
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dz in (-1, 0, 1):
                        for j in cell.get((ci[0] + dx, ci[1] + dy, ci[2] + dz), ()):
                            if lab[j] < 0 and np.linalg.norm(pts[i] - pts[j]) <= radius:
                                lab[j] = cur
                                stack.append(j)
        cur += 1
    return sorted([np.flatnonzero(lab == c) for c in range(cur)], key=len, reverse=True)


def components(m):
    """Face label per connected component (by shared edges), largest component = 0."""
    pairs = face_adjacency(m)[0]
    try:
        from scipy.sparse import coo_matrix
        from scipy.sparse.csgraph import connected_components

        n = len(m.F)
        g = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(n, n))
        _, lab = connected_components(g, directed=False)
    except ImportError:
        lab = np.full(len(m.F), -1)
        for gi, g in enumerate(face_clusters(m, np.ones(len(m.F), bool), (pairs, None))):
            lab[g] = gi
    size = np.bincount(lab, weights=m.area)
    rank = np.argsort(-size)
    remap = np.empty_like(rank)
    remap[rank] = np.arange(len(rank))
    return remap[lab]


def submesh(m, faces):
    F = m.F[faces]
    used, inv = np.unique(F, return_inverse=True)
    return Mesh(m.V[used], inv.reshape(-1, 3))


def weld_edges(m, dist, dihedral_max=25.0, opp_deg=130.0, adj=None):
    """Edges where flow fronts meet (arrival-time gradients of neighbouring faces oppose). Proxy only."""
    T = m.T
    dv = dist[m.F]
    e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    nrm = np.cross(e1, e2)
    nn = (nrm ** 2).sum(1)
    d1, d2 = dv[:, 1] - dv[:, 0], dv[:, 2] - dv[:, 0]
    grad = (np.cross(nrm, e2) * d1[:, None] + np.cross(e1, nrm) * d2[:, None]) / (nn[:, None] + 1e-12)
    pairs, ev = adj if adj is not None else face_adjacency(m)
    ga, gb = grad[pairs[:, 0]], grad[pairs[:, 1]]
    cos = (ga * gb).sum(1) / (np.linalg.norm(ga, axis=1) * np.linalg.norm(gb, axis=1) + 1e-12)
    dih = np.degrees(np.arccos(np.clip((m.N[pairs[:, 0]] * m.N[pairs[:, 1]]).sum(1), -1, 1)))
    sel = (dih < dihedral_max) & (cos < np.cos(np.radians(opp_deg)))
    return m.V[ev[sel]]


def flow_peaks(m, dist, frac=0.55, sep=8.0):
    """Local maxima of the flow-length field (last-to-fill points: air-trap candidates). Proxy only."""
    e, _, _, _ = m.edges()
    ok = np.isfinite(dist)
    nbmax = np.full(len(m.V), -np.inf)
    d = np.where(ok, dist, -np.inf)
    np.maximum.at(nbmax, e[:, 0], d[e[:, 1]])
    np.maximum.at(nbmax, e[:, 1], d[e[:, 0]])
    top = np.nanmax(d[ok])
    cand = np.flatnonzero(ok & (d >= nbmax) & (d > frac * top))
    out = []
    for i in cand[np.argsort(-d[cand])]:
        if all(np.linalg.norm(m.V[i] - m.V[j]) > sep for j in out):
            out.append(i)
    return out


def flat_pad_ok(caster, x, z, radius, y_ref, axis_uv=(0, 2), sign=+1, y_from=None, tol=0.03, n=16):
    """True when a round pad of `radius` at (x, z) is flat: rays along the pull (from below the part when
    sign=+1) all hit the same height y_ref within tol. Use for ejector-pin placement on core faces."""
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    pts = np.zeros((n + 1, 3))
    u, v = axis_uv
    pts[:, u] = x + np.r_[0, radius * np.cos(ang)]
    pts[:, v] = z + np.r_[0, radius * np.sin(ang)]
    pts[:, caster.axis] = y_from
    d = caster.first_hit(pts, sign)
    return bool(np.all(np.isfinite(d)) and np.all(np.abs(y_from + sign * d - y_ref) < tol))


def rainbow(t):
    """Blue -> cyan -> green -> yellow -> red for t in [0, 1] (numpy only). Returns Nx3 in 0..255."""
    t = np.clip(np.asarray(t, float), 0, 1)
    k = np.array([[0, 0, 255], [0, 200, 255], [0, 210, 0], [255, 230, 0], [255, 0, 0]], float)
    x = t * 4
    i = np.minimum(x.astype(int), 3)
    f = (x - i)[:, None]
    return k[i] * (1 - f) + k[i + 1] * f


def draft_rgb(m, pull=(0, 1, 0), lim=0.5):
    """Toolmaker legend: +lim deg and up magenta (cavity), 0 green, -lim and below blue (core)."""
    p = np.asarray(pull, float) / np.linalg.norm(pull)
    sd = np.degrees(np.arcsin(np.clip(m.N @ p, -1, 1)))
    s = np.clip(sd / lim, -1, 1)
    mag, grn, blu = np.array([217, 26, 217.]), np.array([61, 190, 61.]), np.array([38, 77, 242.])
    t = np.abs(s)[:, None]
    return np.where(s[:, None] >= 0, grn * (1 - t) + mag * t, grn * (1 - t) + blu * t)


def draft_ramp(t):
    """Legend ramp for draft_rgb: t=0 blue (-lim), 0.5 green (0), 1 magenta (+lim)."""
    s = np.asarray(t, float) * 2 - 1
    mag, grn, blu = np.array([217, 26, 217.]), np.array([61, 190, 61.]), np.array([38, 77, 242.])
    a = np.abs(s)[:, None]
    return np.where(s[:, None] >= 0, grn * (1 - a) + mag * a, grn * (1 - a) + blu * a)


def legend_png(out, stops, vmin, vmax, ticks, fmt="{:.1f}", title=None, size=(150, 520)):
    """Vertical colour legend (Pillow only). stops: function t->Nx3 rgb."""
    from PIL import Image, ImageDraw

    W_, H_ = size
    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    top, bot, x0, x1 = 40, H_ - 20, 12, 52
    ts = np.linspace(1, 0, bot - top)
    cols = stops(ts).astype(int)
    for i, c in enumerate(cols):
        d.line([(x0, top + i), (x1, top + i)], fill=tuple(c))
    d.rectangle([x0, top, x1, bot], outline=(0, 0, 0))
    font = _font(18)
    for t in ticks:
        y = top + (vmax - t) / (vmax - vmin) * (bot - top)
        d.line([(x1, y), (x1 + 6, y)], fill=(0, 0, 0))
        d.text((x1 + 10, y - 9), fmt.format(t), fill=(0, 0, 0), font=font)
    if title:
        d.text((4, 6), title, fill=(0, 0, 0), font=_font(17))
    img.save(out)
    return str(out)


def _font(sz):
    from PIL import ImageFont

    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf",
              "DejaVuSans.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(f, sz)
        except OSError:
            pass
    return ImageFont.load_default()


# ============================================================ reverse-engineering helpers
def plane_clusters(m, ang_tol_deg=1.0, off_tol=0.02, min_area=1.0):
    """Planar datums: faces grouped by normal (within ang_tol) and offset (within off_tol).
    Returns [{normal, offset, area, n_faces, bbox_min, bbox_max}] largest first (measured)."""
    out = []
    used = np.zeros(len(m.F), bool)
    cosr = np.cos(np.radians(ang_tol_deg))
    for i in np.argsort(-m.area):
        if used[i]:
            continue
        n = m.N[i]
        d = float(m.C[i] @ n)
        sel = ~used & ((m.N @ n) > cosr) & (np.abs(m.C @ n - d) < off_tol)
        used |= sel
        a = float(m.area[sel].sum())
        if a < min_area:
            continue
        w = m.area[sel]
        nn = (m.N[sel] * w[:, None]).sum(0)
        nn /= np.linalg.norm(nn)
        P = m.T[sel].reshape(-1, 3)
        out.append({"normal": np.round(nn, 5).tolist(), "offset": round(float(np.average(m.C[sel] @ nn, weights=w)), 4),
                    "area": round(a, 2), "n_faces": int(sel.sum()), "bbox_min": np.round(P.min(0), 3).tolist(),
                    "bbox_max": np.round(P.max(0), 3).tolist()})
    return out


def fit_circle(xy):
    """Least-squares circle through 2-D points -> (cx, cy, r, rms residual)."""
    xy = np.asarray(xy, float)
    A = np.c_[2 * xy, np.ones(len(xy))]
    b = (xy ** 2).sum(1)
    (cx, cy, c), *_ = np.linalg.lstsq(A, b, rcond=None)
    r = float(np.sqrt(c + cx ** 2 + cy ** 2))
    res = np.linalg.norm(xy - [cx, cy], axis=1) - r
    return float(cx), float(cy), r, float(np.sqrt((res ** 2).mean()))


# ============================================================ renderer (painter's algorithm, Pillow)
VIEWS = {  # (eye direction from the part centre, view-up)
    "cav_iso": ((0.55, 0.72, -0.42), (0, 0, 1)),
    "core_iso": ((-0.55, -0.72, -0.42), (0, 0, 1)),
    "cav_plan": ((0, 1, 0), (1, 0, 0)),
    "core_plan": ((0, -1, 0), (-1, 0, 0)),
    "side": ((1, 0, 0), (0, 1, 0)),
    "end": ((0, 0, 1), (0, 1, 0)),
}
GREEN = (0x3D, 0xBE, 0x3D)


def render(m, face_rgb=GREEN, out="render.png", view="cav_iso", size=(1400, 1000), lines=None,
           line_rgb=(255, 0, 0), line_w=3, points=None, edges=True, margin=0.06, light=(0.35, 0.55, 0.75)):
    """Shaded orthographic render. Returns (path, project(points)->pixel xy). Painter's algorithm:
    fine for display; hidden lines are not removed for `lines`."""
    from PIL import Image, ImageDraw

    d, up = VIEWS[view] if isinstance(view, str) else view
    d = np.asarray(d, float) / np.linalg.norm(d)
    up = np.asarray(up, float)
    r = np.cross(up, d)
    r /= np.linalg.norm(r)
    u = np.cross(d, r)
    c = (m.V.min(0) + m.V.max(0)) / 2
    X, Y, Z = (m.V - c) @ r, (m.V - c) @ u, (m.V - c) @ d
    W, H = size
    span = max((X.max() - X.min()) / (W * (1 - 2 * margin)), (Y.max() - Y.min()) / (H * (1 - 2 * margin)))
    cx, cy = (X.max() + X.min()) / 2, (Y.max() + Y.min()) / 2

    def px(x, y):
        return (W / 2 + (x - cx) / span, H / 2 - (y - cy) / span)

    col = np.asarray(face_rgb, float)
    if col.ndim == 1:
        col = np.tile(col, (len(m.F), 1))
    if col.max() <= 1.0:
        col = col * 255
    Lt = np.asarray(light, float)
    Ld = Lt[0] * r + Lt[1] * u + Lt[2] * d
    Ld /= np.linalg.norm(Ld)
    shade = 0.45 + 0.55 * np.clip(np.abs(m.N @ Ld), 0, 1)
    rgb = np.clip(col[:, :3] * shade[:, None], 0, 255).astype(int)
    depth = Z[m.F].mean(1)
    order = np.argsort(depth)  # far (small Z = away from eye? eye at +d) -> draw smallest first
    img = Image.new("RGB", size, "white")
    dr = ImageDraw.Draw(img)
    PX = np.c_[W / 2 + (X - cx) / span, H / 2 - (Y - cy) / span]
    for f in order:
        tri = PX[m.F[f]]
        dr.polygon([tuple(tri[0]), tuple(tri[1]), tuple(tri[2])], fill=tuple(rgb[f]))
    if edges:  # silhouette and sharp edges between visible faces (outline look)
        e, cnt, inv, fid = m.edges()
        fa = np.full((len(e), 2), -1)
        seen = np.zeros(len(e), int)
        for ei, f in zip(inv, fid):
            if seen[ei] < 2:
                fa[ei, seen[ei]] = f
            seen[ei] += 1
        ok = (fa >= 0).all(1)
        n1, n2 = m.N[fa[ok, 0]], m.N[fa[ok, 1]]
        front1, front2 = (n1 @ d) > 0, (n2 @ d) > 0
        sharp = (n1 * n2).sum(1) < np.cos(np.radians(35))
        sel = (front1 & front2 & sharp) | (front1 != front2)
        for a, b in e[ok][sel]:
            dr.line([tuple(PX[a]), tuple(PX[b])], fill=(20, 70, 20), width=1)
    if lines is not None and len(lines):
        L = np.asarray(lines, float)
        P = L.reshape(-1, 3) - c
        Q = np.c_[W / 2 + (P @ r - cx) / span, H / 2 - (P @ u - cy) / span].reshape(-1, 2, 2)
        for a, b in Q:
            dr.line([tuple(a), tuple(b)], fill=line_rgb, width=line_w)
    for p, rad, colr in points or []:
        q = np.asarray(p, float) - c
        x, y = px(q @ r, q @ u)
        rr = rad / span
        dr.ellipse([x - rr, y - rr, x + rr, y + rr], fill=colr, outline=(0, 0, 0))
    img.save(out)

    def project(points):
        P = np.atleast_2d(np.asarray(points, float)) - c
        return np.c_[W / 2 + (P @ r - cx) / span, H / 2 - (P @ u - cy) / span]

    return str(out), project


def check_environment():
    """Report which optional libraries are importable (so the skill can pick the full or offline path)."""
    rep = {}
    for mod in ("numpy", "scipy", "matplotlib", "PIL", "pptx", "openpyxl", "trimesh", "shapely", "manifold3d",
                "vtk", "build123d", "OCP", "cadquery", "FreeCAD"):
        try:
            __import__(mod)
            rep[mod] = True
        except Exception:
            rep[mod] = False
    rep["can_read_write_step"] = rep["build123d"] or rep["OCP"] or rep["cadquery"] or rep["FreeCAD"]
    return rep


if __name__ == "__main__":
    import json
    import sys

    print(json.dumps(check_environment(), indent=1))
    if len(sys.argv) > 1:
        print(json.dumps(Mesh.load(sys.argv[1]).stats(), indent=1))
