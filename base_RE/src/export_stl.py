"""Write a closed STL from the generated STEP model (OCC tessellation).

Run from base_RE/ after building the STEP model:  python src/export_stl.py

The whole shape is meshed in one pass (shared edges get shared nodes). OCC returns no triangulation
for a few sliver faces (area < 0.01 mm2) that are left where section-driven prisms meet; their outlines
(and the pinholes at the finger-recess revolve axis) are fan-filled so the mesh stays closed. The B-rep itself is valid.
Where two section-driven features touch along a line, the B-rep keeps two coincident edges; in the
mesh they become one edge shared by four triangles (closed, but not strictly 2-manifold there).
"""

from pathlib import Path

import build123d as bd
import numpy as np
import trimesh
from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopLoc import TopLoc_Location

ROOT = Path(__file__).resolve().parent.parent


def mesh_shape(shape, tol=0.005, ang=0.1) -> tuple[trimesh.Trimesh, int]:
    BRepMesh_IncrementalMesh(shape.wrapped, tol, False, ang, True)
    verts, tris, patched = [], [], 0
    for face in shape.faces():
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(face.wrapped, loc)
        rev = face.wrapped.Orientation() == TopAbs_REVERSED
        if tri is None:  # sliver face: its outline is closed later by close_cracks()
            patched += 1
            continue
        trsf = loc.Transformation()
        n0 = len(verts)
        for i in range(1, tri.NbNodes() + 1):
            p = tri.Node(i).Transformed(trsf)
            verts.append((p.X(), p.Y(), p.Z()))
        for i in range(1, tri.NbTriangles() + 1):
            a, b, c = tri.Triangle(i).Get()
            tris.append((n0 + a - 1, n0 + c - 1, n0 + b - 1) if rev else (n0 + a - 1, n0 + b - 1, n0 + c - 1))
    m = trimesh.Trimesh(np.array(verts), np.array(tris), process=False)
    m.merge_vertices(digits_vertex=6)
    # collapse micro-edges (< 5 microns long) left where section-driven prisms meet the skin
    from scipy.sparse.csgraph import connected_components
    e = m.edges_unique
    pairs = e[m.edges_unique_length < 0.005]
    if len(pairs):
        from scipy.sparse import coo_matrix
        n = len(m.vertices)
        k, lab = connected_components(coo_matrix((np.ones(len(pairs)), pairs.T), shape=(n, n)), directed=False)
        rep = np.zeros(k, int)
        rep[lab] = np.arange(n)  # one surviving vertex per cluster
        m = trimesh.Trimesh(m.vertices, rep[lab[m.faces]], process=False)
    m.update_faces(m.nondegenerate_faces())
    m.remove_unreferenced_vertices()
    return m, patched


def close_cracks(m: trimesh.Trimesh) -> int:
    """Fan-fill the boundary loops left by tessellation mismatches (sub-0.3 mm cracks at a revolve axis
    and at sliver faces). Returns the number of loops filled."""
    import networkx as nx

    e = m.edges_sorted[trimesh.grouping.group_rows(m.edges_sorted, require_count=1)]
    if not len(e):
        return 0
    g = nx.Graph()
    g.add_edges_from(map(tuple, e))
    new = []
    for cyc in nx.cycle_basis(g):
        span = np.ptp(m.vertices[cyc], axis=0).max()
        assert span < 1.5, f"open boundary of {span:.2f} mm is not a tessellation crack"
        new += [(cyc[0], cyc[i], cyc[i + 1]) for i in range(1, len(cyc) - 1)]
    m.faces = np.vstack([m.faces, new])
    trimesh.repair.fix_normals(m)
    return len(nx.cycle_basis(g))


if __name__ == "__main__":
    from collections import Counter

    shape = bd.import_step(ROOT / "STEP" / "base.step")
    mesh, patched = mesh_shape(shape)
    cracks = close_cracks(mesh)
    use = Counter(Counter(map(tuple, mesh.edges_sorted)).values())
    assert use.get(1, 0) == 0 and all(k % 2 == 0 for k in use), f"open mesh: edge use {dict(use)}"
    out = ROOT / "STL" / "base.stl"
    mesh.export(out)
    print(f"wrote {out.relative_to(ROOT)}: {len(mesh.faces)} faces, no open edges, volume {mesh.volume:.2f} mm3;"
          f" {patched} sliver face(s) without OCC triangulation, {cracks} tessellation crack(s) closed,"
          f" {use.get(4, 0)} edge(s) shared by 4 triangles where two features touch along a line")
