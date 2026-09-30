"""Read what a STEP file says about itself, with no CAD kernel (plain text parsing).

    python step_info.py part.step            -> JSON: header, product names, units, face / surface counts,
                                                 vertex / point bounding boxes (approximate)

This does NOT tessellate the part: without OCC (build123d / cadquery / FreeCAD) a STEP cannot be turned into a
mesh here. Use the numbers only to fill product information and to sanity-check the STL the user exports.
The vertex bounding box is the better size estimate; the all-point box includes construction points (B-spline
poles, axis origins) and can be far larger than the part. Label both "approximate, from STEP text".
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path


def step_info(path):
    txt = Path(path).read_text(errors="replace")
    head = txt[: txt.find("DATA;")] if "DATA;" in txt else txt[:4000]
    info = {"file": Path(path).name, "size_kB": round(len(txt) / 1024, 1)}
    m = re.search(r"FILE_NAME\s*\((.*?)\);", head, re.S)
    if m:
        parts = re.findall(r"'([^']*)'", m.group(1))
        info["file_name_header"] = parts[:1]
        info["originating_system"] = [p for p in parts[1:] if p][-2:]
    m = re.search(r"FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'", head)
    if m:
        info["schema"] = m.group(1)
    info["products"] = sorted(set(re.findall(r"PRODUCT\s*\(\s*'([^']*)'", txt)))[:20]
    units = []
    if re.search(r"SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.", txt):
        units.append("mm")
    if re.search(r"SI_UNIT\s*\(\s*\$\s*,\s*\.METRE\.", txt):
        units.append("m")
    if re.search(r"CONVERSION_BASED_UNIT\s*\(\s*'INCH'", txt, re.I):
        units.append("inch")
    info["length_units"] = units or ["unknown"]
    ents = Counter(re.findall(r"=\s*([A-Z_0-9]+)\s*\(", txt))
    keys = ("MANIFOLD_SOLID_BREP", "BREP_WITH_VOIDS", "SHELL_BASED_SURFACE_MODEL", "ADVANCED_FACE", "PLANE",
            "CYLINDRICAL_SURFACE", "CONICAL_SURFACE", "SPHERICAL_SURFACE", "TOROIDAL_SURFACE",
            "B_SPLINE_SURFACE_WITH_KNOTS", "SURFACE_OF_REVOLUTION", "SURFACE_OF_LINEAR_EXTRUSION", "EDGE_CURVE")
    info["entities"] = {k: ents[k] for k in keys if ents.get(k)}
    # complex (multi-type) B-spline surfaces are written as "( B_SPLINE_SURFACE(...) ... )"
    nb = len(re.findall(r"B_SPLINE_SURFACE\s*\(", txt))
    if nb and "B_SPLINE_SURFACE_WITH_KNOTS" not in info["entities"]:
        info["entities"]["B_SPLINE_SURFACE (complex)"] = nb
    cp = {int(i): (float(x), float(y), float(z)) for i, x, y, z in re.findall(
        r"#(\d+)\s*=\s*CARTESIAN_POINT\s*\(\s*'[^']*'\s*,\s*\(\s*([-+\d.Ee]+)\s*,\s*([-+\d.Ee]+)\s*,\s*([-+\d.Ee]+)\s*\)",
        txt)}
    vid = [int(i) for i in re.findall(r"VERTEX_POINT\s*\(\s*'[^']*'\s*,\s*#(\d+)", txt)]
    for key, ids, note in (("vertex_bbox", vid, "edge vertices only: a lower bound of the part size (curved faces "
                                                 "can bulge past their vertices)"),
                           ("points_bbox", list(cp), "all points incl. construction points: can be much larger "
                                                     "than the part")):
        P = [cp[i] for i in ids if i in cp]
        if P:
            lo = [min(p[k] for p in P) for k in range(3)]
            hi = [max(p[k] for p in P) for k in range(3)]
            info[key] = {"min": [round(v, 3) for v in lo], "max": [round(v, 3) for v in hi],
                         "size": [round(b - a, 3) for a, b in zip(lo, hi)], "note": "approximate: " + note}
    return info


if __name__ == "__main__":
    print(json.dumps(step_info(sys.argv[1]), indent=1))
