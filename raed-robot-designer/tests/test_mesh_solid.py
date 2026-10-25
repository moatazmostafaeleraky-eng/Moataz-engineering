import manifold3d
import numpy as np
import pytest
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps

from raedbots.cad import mesh_solid


def _flat(manifold):
    mesh = manifold.to_mesh()
    return mesh.vert_properties[mesh.tri_verts].reshape(-1).tolist()


def _volume_mm3(shape):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    return props.Mass()


def test_topology_builder_keeps_every_closed_body_and_its_volume():
    # Two disjoint closed bodies in metres: a 40 mm cube and a 15 mm-radius sphere.
    cube = manifold3d.Manifold.cube([0.04, 0.04, 0.04])
    sphere = manifold3d.Manifold.sphere(0.015, 48).translate([0.1, 0, 0])
    body = cube + sphere
    shape, report = mesh_solid._build_occt_solids_from_topology(_flat(body), part_name='T')
    assert report['solid_count'] == 2 and report['brep_method'] == 'shared_edge_topology'
    assert BRepCheck_Analyzer(shape).IsValid()
    assert _volume_mm3(shape) == pytest.approx(body.volume() * 1e9, rel=1e-6)


def test_closed_mesh_falls_back_to_topology_when_sewing_is_invalid(monkeypatch):
    def invalid_sewing(*args, **kwargs):
        raise ValueError('one reconstructed BREP solid failed OCCT validation')

    monkeypatch.setattr(mesh_solid, '_build_occt_solids', invalid_sewing)
    shape, report = mesh_solid._closed_mesh_to_occt(_flat(manifold3d.Manifold.cube([0.02, 0.03, 0.05])), tolerance_mm=0.05, part_name='T')
    assert report['brep_method'] == 'shared_edge_topology'
    assert 'failed OCCT validation' in report['sewing_error']
    assert _volume_mm3(shape) == pytest.approx(20 * 30 * 50, rel=1e-6)


def test_weld_and_close_repairs_split_vertices_and_a_pinhole_without_approximation():
    sphere = manifold3d.Manifold.sphere(0.02, 64)
    flat = np.asarray(_flat(sphere)).reshape(-1, 9)
    # RoboDK-style input: every triangle carries its own vertex copies, one triangle is missing.
    with_hole = flat[1:].reshape(-1).tolist()
    closed, report = mesh_solid._weld_and_close_repair(with_hole)
    assert report['status'] == 'welded_and_closed' and report['holes_closed'] == 1
    assert report['volume_m3'] == pytest.approx(sphere.volume(), rel=1e-3)
    shape, brep = mesh_solid._closed_mesh_to_occt(closed, tolerance_mm=0.05, part_name='S')
    assert BRepCheck_Analyzer(shape).IsValid()
    assert _volume_mm3(shape) == pytest.approx(sphere.volume() * 1e9, rel=1e-3)


def test_home_pose_frames_place_the_abb_irb1100_flange():
    from raedbots.robot_import.robodk_robot import home_pose_frames
    half = np.pi / 2
    # Modified DH of the ABB IRB 1100-4/0.58 RoboDK model (metres, radians).
    mdh = [
        {"alpha": 0.0, "a": 0.0, "theta": 0.0, "d": 0.327},
        {"alpha": -half, "a": 0.0, "theta": -half, "d": 0.0},
        {"alpha": 0.0, "a": 0.28, "theta": 0.0, "d": 0.0},
        {"alpha": -half, "a": 0.01, "theta": 0.0, "d": 0.3},
        {"alpha": half, "a": 0.0, "theta": 0.0, "d": 0.0},
        {"alpha": -half, "a": 0.0, "theta": np.pi, "d": 0.064},
    ]
    frames = home_pose_frames(mdh)
    assert len(frames) == 7
    assert np.allclose(frames[0], np.eye(4))
    assert np.allclose(frames[-1][:3, 3], [0.364, 0.0, 0.617], atol=1e-9)
