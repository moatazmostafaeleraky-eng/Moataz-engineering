"""Run the feature-CAD rebuild for one mesh in an isolated process.

OpenCascade booleans can crash natively on awkward input; a separate process means a
crash costs that part its feature CAD, not the whole export.

Usage: python -m raedbots.cad.feature_worker mesh.npz out.brep report.json
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


def main(argv: list[str]) -> int:
    from OCP.BRepTools import BRepTools

    from raedbots.cad.feature_rebuild import feature_solid

    data = np.load(argv[0])
    solid, report = feature_solid(data["V"], data["F"], part_name=str(data["name"]))
    BRepTools.Write_s(solid, argv[1])
    Path(argv[2]).write_text(json.dumps(report), encoding="utf-8")
    return 0


def feature_in_subprocess(vertices_mm: np.ndarray, faces: np.ndarray, *, part_name: str, timeout_s: float = 1800.0):
    """Return (shape, report) or (None, report with the failure reason)."""
    from OCP.BRep import BRep_Builder
    from OCP.BRepTools import BRepTools
    from OCP.TopoDS import TopoDS_Shape

    with tempfile.TemporaryDirectory(prefix="raed-feature-") as tmp:
        tmp = Path(tmp)
        np.savez(tmp / "mesh.npz", V=vertices_mm, F=faces, name=part_name)
        env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in sys.path if p))
        cmd = [sys.executable, "-m", "raedbots.cad.feature_worker", str(tmp / "mesh.npz"), str(tmp / "out.brep"),
               str(tmp / "report.json")]
        try:
            run = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=timeout_s)
        except subprocess.TimeoutExpired:
            return None, {"status": "feature_timeout", "timeout_s": timeout_s}
        if run.returncode != 0 or not (tmp / "out.brep").is_file():
            tail = (run.stderr or "").strip().splitlines()[-1:] or [f"exit code {run.returncode}"]
            return None, {"status": "feature_failed", "error": tail[0][:300], "exit_code": run.returncode}
        shape = TopoDS_Shape()
        BRepTools.Read_s(shape, str(tmp / "out.brep"), BRep_Builder())
        return shape, json.loads((tmp / "report.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
