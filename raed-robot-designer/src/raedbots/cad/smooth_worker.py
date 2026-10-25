"""Run smooth surface reconstruction for one mesh in an isolated process.

OpenCascade can crash natively on degenerate input; running each link in its own
process means a crash costs that link its smooth surfaces, not the whole export.

If OpenCascade crashes on one patch, the worker is restarted with that patch
built from its original triangles, so a single bad patch only loses its own
smoothness.

Usage: python -m raedbots.cad.smooth_worker mesh.npz out.brep report.json tol_mm skip trace
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np


def main(argv: list[str]) -> int:
    from OCP.BRepTools import BRepTools

    from raedbots.cad.smooth_surface import smooth_solid

    mesh_path, brep_path, report_path, tol = argv[0], argv[1], argv[2], float(argv[3])
    skip = frozenset(int(x) for x in argv[4].split(",") if x)
    data = np.load(mesh_path)
    solid, report = smooth_solid(data["V"], data["F"], tol_mm=tol, part_name=str(data["name"]),
                                 skip=skip, trace=Path(argv[5]))
    report["crash_isolated_patches"] = sorted(skip)
    BRepTools.Write_s(solid, brep_path)
    Path(report_path).write_text(json.dumps(report), encoding="utf-8")
    return 0


def smooth_in_subprocess(vertices_mm: np.ndarray, faces: np.ndarray, *, part_name: str,
                         tol_mm: float = 0.25, timeout_s: float = 1800.0, max_isolated: int = 40):
    """Return (shape, report) or (None, report with the failure reason)."""
    from OCP.BRep import BRep_Builder
    from OCP.BRepTools import BRepTools
    from OCP.TopoDS import TopoDS_Shape

    with tempfile.TemporaryDirectory(prefix="raed-smooth-") as tmp:
        tmp = Path(tmp)
        np.savez(tmp / "mesh.npz", V=vertices_mm, F=faces, name=part_name)
        env = dict(os.environ, PYTHONPATH=os.pathsep.join(p for p in sys.path if p))
        trace = tmp / "trace.txt"
        skip: list[int] = []
        deadline = time.monotonic() + timeout_s
        while True:
            cmd = [sys.executable, "-m", "raedbots.cad.smooth_worker", str(tmp / "mesh.npz"),
                   str(tmp / "out.brep"), str(tmp / "report.json"), str(tol_mm), ",".join(map(str, skip)), str(trace)]
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None, {"status": "smooth_timeout", "timeout_s": timeout_s, "crash_isolated_patches": skip}
            try:
                run = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=remaining)
            except subprocess.TimeoutExpired:
                return None, {"status": "smooth_timeout", "timeout_s": timeout_s, "crash_isolated_patches": skip}
            if run.returncode == 0 and (tmp / "out.brep").is_file():
                break
            # A native crash leaves the patch being built in the trace file: isolate it and retry.
            crashed = trace.read_text().split()[0] if trace.is_file() and trace.read_text().strip() else None
            if run.returncode < 0 and crashed is not None and int(crashed) not in skip and len(skip) < max_isolated:
                skip.append(int(crashed))
                continue
            tail = (run.stderr or "").strip().splitlines()[-1:] or [f"exit code {run.returncode}"]
            return None, {"status": "smooth_failed", "error": tail[0][:300], "exit_code": run.returncode,
                          "crash_isolated_patches": skip}
        shape = TopoDS_Shape()
        BRepTools.Read_s(shape, str(tmp / "out.brep"), BRep_Builder())
        return shape, json.loads((tmp / "report.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
