import json
import zipfile

import manifold3d
import numpy as np
import pytest

from raedbots.cad.feature_rebuild import feature_solid


def _mesh(manifold):
    mesh = manifold.to_mesh()
    return np.asarray(mesh.vert_properties[:, :3], float), np.asarray(mesh.tri_verts, np.int64)


def _block_with_bores():
    """80 x 60 x 20 mm block, a 10 mm through hole and a blind 24 mm bore 12 mm deep from the top."""
    block = manifold3d.Manifold.cube([80, 60, 20], True)
    hole = manifold3d.Manifold.cylinder(30, 5, 5, 48, True).translate([25, 0, 0])
    bore = manifold3d.Manifold.cylinder(13, 12, 12, 64, False).translate([-15, 0, -2])
    return _mesh(block - hole - bore)


def test_block_is_rebuilt_from_features_with_no_triangles():
    V, F = _block_with_bores()
    _, report = feature_solid(V, F, part_name="block")
    assert report["valid"] and report["solid_count"] == 1
    assert report["analytic_only"]
    assert set(report["surface_types"]) <= {"plane", "cylinder"}
    # The blind bore cannot be seen in any outline: it has to come from a later step.
    assert any(step["step"] in ("bore", "layered_hull") for step in report["steps"][1:])
    assert report["deviation"]["within_1mm_pct"] >= 98.0
    assert abs(report["deviation"]["volume_diff_pct"]) < 2.0


def test_turned_part_gets_revolved_surfaces():
    # Shaft: 40 mm diameter for 20 mm, then a cone down to 24 mm over 25 mm (axis Z).
    shaft = manifold3d.Manifold.cylinder(20, 20, 20, 72, False)
    cone = manifold3d.Manifold.cylinder(25, 20, 12, 72, False).translate([0, 0, 20])
    V, F = _mesh(shaft + cone)
    _, report = feature_solid(V, F, part_name="shaft")
    assert report["valid"] and report["analytic_only"]
    assert any(step["step"] == "revolved_hull" for step in report["steps"])
    assert report["surface_types"].get("cone") or report["surface_types"].get("cylinder")
    assert report["deviation"]["within_1mm_pct"] >= 95.0


def test_stl_converter_writes_a_feature_step(tmp_path):
    import trimesh

    from raedbots.cad.stl_convert import convert_stl

    V, F = _block_with_bores()
    stl = tmp_path / "block.stl"
    trimesh.Trimesh(V, F).export(stl)
    out = tmp_path / "block-STEP.zip"
    report = convert_stl(stl, out, mode="feature")
    assert report["surface"] == "feature"
    with zipfile.ZipFile(out) as archive:
        names = set(archive.namelist())
        assert {"block.step", "conversion-report.json", "README.txt"} <= names
        saved = json.loads(archive.read("conversion-report.json"))
    assert saved["feature"]["analytic_only"]


def test_stl_converter_rejects_unknown_mode(tmp_path):
    from raedbots.cad.stl_convert import convert_stl

    with pytest.raises(ValueError):
        convert_stl(tmp_path / "x.stl", tmp_path / "x.zip", mode="magic")
