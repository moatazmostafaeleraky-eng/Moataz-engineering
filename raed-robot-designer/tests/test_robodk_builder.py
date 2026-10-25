import io
import json
import sys
import types
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from raedbots.api.app import app
from raedbots.robot_import.robodk_builder import PART_ROLES, create_robodk_bundle
from raedbots.storage import store

STEP = b"ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n"


def config():
    return {
        "robot_name": "Test Robot",
        "parameters": [float(i) for i in range(13)],
        "home_positions_deg": [0.0] * 6,
        "joint_senses": [1, -1, 1, 1, -1, 1],
        "lower_limits_deg": [-180.0] * 6,
        "upper_limits_deg": [180.0] * 6,
    }


def part_files(tmp_path):
    result = {}
    for role in PART_ROLES:
        path = tmp_path / f"{role}.step"
        path.write_bytes(STEP)
        result[role] = path
    return result


def test_native_robodk_api_builds_and_packages_robot_with_ownership(tmp_path, monkeypatch):
    calls = {}

    class FakeItem:
        def __init__(self, path=None):
            self.path = path

        def Valid(self):
            return True

        def setName(self, name):
            self.name = name

        def Save(self, filename):
            Path(filename).write_bytes(b"mock-RoboDK-robot")

    class FakeRoboDK:
        def Render(self, enabled):
            calls.setdefault("render", []).append(enabled)

        def AddStation(self, name):
            calls["station"] = name

        def AddFile(self, filename):
            calls.setdefault("files", []).append(Path(filename).name)
            return FakeItem(filename)

        def BuildMechanism(self, *args, **kwargs):
            calls["build_args"] = args
            calls["build_kwargs"] = kwargs
            return FakeItem()

        def Finish(self):
            calls["finished"] = True

    package_module = types.ModuleType("robodk")
    package_module.__path__ = []
    api_module = types.ModuleType("robodk.robolink")
    api_module.Robolink = FakeRoboDK
    api_module.MAKE_ROBOT_6DOF = 6
    monkeypatch.setitem(sys.modules, "robodk", package_module)
    monkeypatch.setitem(sys.modules, "robodk.robolink", api_module)

    output = tmp_path / "native.zip"
    mode = create_robodk_bundle(part_files(tmp_path), config(), output, tmp_path / "work")
    assert mode == "native_robot"
    assert calls["station"] == "Test Robot - RAED STEP Build"
    assert calls["files"] == [f"{role}.step" for role in PART_ROLES]
    assert calls["build_args"][0] == 6
    assert len(calls["build_args"][2]) == 13
    assert calls["build_args"][3] == [0.0] * 6
    assert calls["build_args"][5] == [1, -1, 1, 1, -1, 1]
    assert calls["build_kwargs"] == {"name": "Test Robot"}
    assert calls["finished"] is True
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        assert "Test-Robot.robot" in names
        assert "COPYRIGHT.txt" in names
        assert archive.read("Test-Robot.robot") == b"mock-RoboDK-robot"
        assert archive.read("COPYRIGHT.txt").decode().strip() == "Designed by: Moataz Mostafa\nAll rights reserved."
        assert "RoboDK API created the .robot file." in archive.read("build-status.json").decode()


def test_macro_fallback_contains_step_parts_config_macro_and_copyright(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "robodk", None)
    monkeypatch.setitem(sys.modules, "robodk.robolink", None)
    output = tmp_path / "fallback.zip"
    mode = create_robodk_bundle(part_files(tmp_path), config(), output, tmp_path / "work")
    assert mode == "macro_required"
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        assert all(f"parts/{role}.step" in names for role in PART_ROLES)
        assert {"config.json", "build_in_robodk.py", "README.txt", "COPYRIGHT.txt", "build-status.json"}.issubset(names)
        macro = archive.read("build_in_robodk.py").decode()
        compile(macro, "build_in_robodk.py", "exec")
        configuration = json.loads(archive.read("config.json"))
        assert configuration["output_filename"] == "Test-Robot.robot"
        assert len(configuration["parameters"]) == 13
        assert "RoboDK Python API is not installed" in archive.read("build-status.json").decode()
        assert "Designed by: Moataz Mostafa" in archive.read("README.txt").decode()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA", tmp_path / "projects")
    with TestClient(app) as instance:
        yield instance


def form_data(parameters=None):
    return {
        "robot_name": "Test Robot",
        "parameters_json": json.dumps(parameters if parameters is not None else [0] * 13),
        "home_json": json.dumps([0] * 6),
        "lower_limits_json": json.dumps([-180] * 6),
        "upper_limits_json": json.dumps([180] * 6),
        "joint_senses_json": json.dumps([1] * 6),
        "part_map_json": json.dumps({role: index for index, role in enumerate(PART_ROLES)}),
    }


def test_step_build_endpoint_returns_macro_bundle_when_robodk_is_unavailable(client, monkeypatch):
    monkeypatch.setitem(sys.modules, "robodk", None)
    monkeypatch.setitem(sys.modules, "robodk.robolink", None)
    uploads = [("step_files", (f"{role}.step", io.BytesIO(STEP), "application/step")) for role in PART_ROLES]
    response = client.post("/api/robodk/build", data=form_data(), files=uploads)
    assert response.status_code == 200, response.text
    assert response.headers["X-RAED-ROBDK-MODE"] == "macro_required"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert "build_in_robodk.py" in archive.namelist()
        assert "parts/joint6.step" in archive.namelist()
        assert archive.read("COPYRIGHT.txt").decode().startswith("Designed by: Moataz Mostafa")


def test_step_build_endpoint_rejects_invalid_parameter_count_and_duplicate_mapping(client):
    uploads = [("step_files", (f"{role}.step", io.BytesIO(STEP), "application/step")) for role in PART_ROLES]
    short = client.post("/api/robodk/build", data=form_data(parameters=[0] * 12), files=uploads)
    assert short.status_code == 422

    duplicate = form_data()
    duplicate["part_map_json"] = json.dumps({role: 0 for role in PART_ROLES})
    uploads = [("step_files", (f"{role}.step", io.BytesIO(STEP), "application/step")) for role in PART_ROLES]
    response = client.post("/api/robodk/build", data=duplicate, files=uploads)
    assert response.status_code == 422


def test_builder_tab_is_wired_and_never_claims_step_contains_kinematics():
    root = Path(__file__).resolve().parents[1]
    html = (root / "src" / "raedbots" / "web" / "index.html").read_text(encoding="utf-8")
    script = (root / "src" / "raedbots" / "web" / "app.js").read_text(encoding="utf-8")
    assert 'id="tab-robodk-builder"' in html
    assert 'id="rdk-parameters"' in html
    assert "data-tab=\"robodk-builder\"" in html
    assert "app never infers robot kinematics from geometry alone" in html
    assert "BuildMechanism" in (root / "src" / "raedbots" / "robot_import" / "robodk_builder.py").read_text(encoding="utf-8")
    assert "'robodk-builder':'benchmark'" in script
