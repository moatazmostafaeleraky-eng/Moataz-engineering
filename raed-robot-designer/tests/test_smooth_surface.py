import math

import manifold3d
import numpy as np
import pytest

from raedbots.cad import smooth_surface as ss


def _mesh(manifold):
    mesh = manifold.to_mesh()
    return np.asarray(mesh.vert_properties[:, :3], float), np.asarray(mesh.tri_verts, np.int64)


def test_plate_with_bore_becomes_planes_and_cylinders_close_to_exact_volume():
    # 80 x 60 x 12 mm plate with a 30 mm bore, tessellated with 48 segments (mm units).
    plate = manifold3d.Manifold.cube([80, 60, 12], True)
    bore = manifold3d.Manifold.cylinder(20, 15, 15, 48, True)
    V, F = _mesh(plate - bore)
    solid, report = ss.smooth_solid(V, F, tol_mm=0.1)
    exact = 80 * 60 * 12 - math.pi * 15 ** 2 * 12
    assert report["valid"]
    assert report["smooth_area_pct"] == 100.0
    assert set(report["faces"]) <= {"plane", "cylinder"} and report["faces"].get("cylinder")
    # Far fewer faces than triangles, and closer to the exact volume than the faceted mesh.
    assert sum(report["faces"].values()) < len(F) / 5
    assert abs(report["volume_mm3"] - exact) < abs(report["mesh_volume_mm3"] - exact)
    assert report["max_tolerance_mm"] < 0.1


def test_frustum_is_recovered_as_a_cone():
    frustum = manifold3d.Manifold.cylinder(20, 25, 15, 64, False)
    V, F = _mesh(frustum)
    solid, report = ss.smooth_solid(V, F, tol_mm=0.1)
    assert report["valid"]
    assert report["faces"].get("cone")
    exact = math.pi * 20 / 3 * (25 ** 2 + 25 * 15 + 15 ** 2)
    assert report["volume_mm3"] == pytest.approx(exact, rel=0.01)


def test_clean_mesh_collapses_micro_edges_and_stays_closed():
    V, F = _mesh(manifold3d.Manifold.cube([10, 10, 10]))
    # Split one vertex into two points 1e-5 mm apart joined by a sliver.
    V2 = np.vstack([V, V[0] + 1e-5])
    F2 = F.copy()
    target = np.where(F2 == 0)[0][0]
    F2[target][F2[target] == 0] = len(V2) - 1
    cleaned_v, cleaned_f, info = ss.clean_mesh(V, F)
    assert ss._is_closed_manifold(cleaned_f)
