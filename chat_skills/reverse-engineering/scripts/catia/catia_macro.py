"""Feature spec -> CATIA V5 macro (.CATScript, VBScript) that builds the part as a native feature tree and
saves it as .CATPart. Pure Python: runs offline too. The macro can only be executed inside CATIA.

    python catia_macro.py part_spec.json --out part.CATScript

What the macro builds (CATIA V5 Part Design, one PartBody):
  * every spec parameter as a CATIA Length parameter (Knowledge > Parameters)
  * a geometrical set "RE_Planes" with one offset plane per sketch, its offset driven by a formula
  * each pad / pocket as a named sketch + named feature with MIRRORED EXTENT (IsSymmetric): the sketch plane sits
    at the middle of the extent, so the result doesn't depend on CATIA's default direction; the half length
    and the plane offset are formulas of the parameters (edit a parameter -> the part updates)
  * shafts / grooves with the sketch axis as the revolve axis, mirrors about offset planes
  * sketches with shared end points (closed profiles); rectangle sides get H/V + length constraints and circles
    a radius constraint driven by the parameters when the spec gives them as parameter expressions
  * a log: every step runs under error trapping; at the end a message lists failed steps and the manual steps
    (edge fillets / drafts, which need edge picks in CATIA)
Run it: Tools > Macro > Macros (Alt+F8) > Macro libraries > add the folder > select > Run.
"""

from __future__ import annotations

import argparse
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import feature_spec as fs  # noqa: E402

BASE_PLANE = {"X": "PlaneYZ", "Y": "PlaneZX", "Z": "PlaneXY"}  # base plane whose normal is that axis


def num(x):
    return f"{x:.6f}".rstrip("0").rstrip(".") if abs(x) > 1e-12 else "0"


def formula(expr):
    """Spec expression -> CATIA formula text: numeric literals that are added / subtracted get 'mm'."""
    s = str(expr)
    toks = re.findall(r"\d+\.?\d*(?:[eE][-+]?\d+)?|[A-Za-z_]\w*|\S", s)
    out = []
    for i, t in enumerate(toks):
        if re.fullmatch(r"\d+\.?\d*(?:[eE][-+]?\d+)?", t):
            prev = toks[i - 1] if i else ""
            nxt = toks[i + 1] if i + 1 < len(toks) else ""
            out.append(t if prev in ("*", "/") or nxt in ("*", "/") else t + "mm")
        elif t == "sqrt":
            out.append("sqrt")
        else:
            out.append(t)
    return re.sub(r"\b(abs|sqrt|sin|cos|tan) \(", r"\1(", " ".join(out))


class VB:
    def __init__(self):
        self.lines = []
        self.n = 0

    def w(self, s=""):
        self.lines.append(s)

    def uid(self, p):
        self.n += 1
        return f"{p}{self.n}"

    def step(self, label):
        """Close the previous error-trapped block and open a new one."""
        self.w('  If Err.Number <> 0 Then log = log & "FAILED: " & stepName & " (" & Err.Description & ")" & vbCrLf: nFail = nFail + 1: Err.Clear')
        self.w(f'  stepName = "{label}"')


def emit(spec):
    P = fs.resolve_params(spec)
    vb = VB()
    w = vb.w
    name = spec.get("part", "Part")
    w("Language=\"VBSCRIPT\"")
    w(f"' {name}: generated from a feature spec by catia_macro.py (reverse-engineering skill).")
    w("' Builds the part as a native CATIA V5 feature tree and saves it as .CATPart.")
    w("' Not executed where it was generated: run it in CATIA and check the log at the end.")
    w("")
    w("Sub CATMain()")
    w("  Dim log, stepName, nFail, ax(8)")
    w('  log = "": nFail = 0: stepName = "start"')
    w("  On Error Resume Next")
    w('  Set doc = CATIA.Documents.Add("Part")')
    w("  Set part1 = doc.Part")
    w(f'  doc.Product.PartNumber = "{name}"')
    w("  Set body1 = part1.MainBody")
    w("  Set params = part1.Parameters")
    w("  Set rels = part1.Relations")
    w("  Set hsf = part1.HybridShapeFactory")
    w("  Set sf = part1.ShapeFactory")
    w("  Set org = part1.OriginElements")
    w("  Set hb = part1.HybridBodies.Add()")
    w('  hb.Name = "RE_Planes"')
    vb.step("parameters")
    for k, v in spec["params"].items():
        w(f'  Set prm = params.CreateDimension("{k}", "LENGTH", {num(P[k])})')
        if fs.is_expr(v):
            w(f'  rels.CreateFormula "F_{k}", "", prm, "{formula(v)}"')
    manual = []

    def plane_for(normal, offset_expr, offset_val, label):
        pl = vb.uid("pl")
        w(f"  Set {pl} = hsf.AddNewPlaneOffset(part1.CreateReferenceFromObject(org.{BASE_PLANE[normal]}), "
          f"{num(offset_val)}, False)")
        w(f"  hb.AppendHybridShape {pl}")
        w(f'  {pl}.Name = "Plane_{label}"')
        if offset_expr is not None:
            w(f'  rels.CreateFormula "F_Plane_{label}", "", {pl}.Offset, "{formula(offset_expr)}"')
        w("  part1.InWorkObject = hb")
        w("  part1.Update")
        return pl

    def sketch(normal, pl, offset_val, profile, label, axis=None):
        hx, vx = fs.FRAME[normal]
        o = [0.0, 0.0, 0.0]
        o[fs.AX[normal]] = offset_val
        sk = vb.uid("sk")
        w("  part1.InWorkObject = body1")
        w(f"  Set {sk} = body1.Sketches.Add(part1.CreateReferenceFromObject({pl}))")
        w(f'  {sk}.Name = "Sketch_{label}"')
        for i, val in enumerate(list(o) + list(hx) + list(vx)):
            w(f"  ax({i}) = {num(float(val))}")
        w(f"  {sk}.SetAbsoluteAxisData ax")
        w(f"  Set f2d = {sk}.OpenEdition()")
        w(f"  Set cst = {sk}.Constraints")
        for lp in fs.loops(profile):
            segs = fs.loop_segments(lp, P)
            if segs[0][0] == "circle":
                c = vb.uid("c")
                (hc, vc), r = segs[0][1], segs[0][2]
                w(f"  Set {c} = f2d.CreateClosedCircle({num(hc)}, {num(vc)}, {num(r)})")
                if "circle" in lp and fs.is_expr(lp["circle"][2]):
                    k = vb.uid("k")
                    w(f"  Set {k} = cst.AddMonoEltCst(14, part1.CreateReferenceFromObject({c}))  ' catCstTypeRadius")
                    w(f'  rels.CreateFormula "F_{label}_R{vb.n}", "", {k}.Dimension, "{formula(lp["circle"][2])}"')
                continue
            pts = [s[1] for s in segs]
            pv = []
            for (h, v) in pts:
                p = vb.uid("p")
                w(f"  Set {p} = f2d.CreatePoint({num(h)}, {num(v)})")
                pv.append(p)
            elems = []
            for i, s in enumerate(segs):
                a, b = pv[i], pv[(i + 1) % len(pv)]
                e = vb.uid("e")
                if s[0] == "line":
                    (h0, v0), (h1, v1) = s[1], s[2]
                    w(f"  Set {e} = f2d.CreateLine({num(h0)}, {num(v0)}, {num(h1)}, {num(v1)})")
                    w(f"  {e}.StartPoint = {a}")
                    w(f"  {e}.EndPoint = {b}")
                else:
                    (hc, vc), r, t1, t3, ccw = fs.arc_from_3pts(s[1], s[2], s[3])
                    if ccw:
                        w(f"  Set {e} = f2d.CreateCircle({num(hc)}, {num(vc)}, {num(r)}, {num(t1)}, "
                          f"{num(t3 if t3 > t1 else t3 + 2 * math.pi)})")
                        w(f"  {e}.StartPoint = {a}")
                        w(f"  {e}.EndPoint = {b}")
                    else:  # CATIA arcs run counter-clockwise: swap the ends
                        w(f"  Set {e} = f2d.CreateCircle({num(hc)}, {num(vc)}, {num(r)}, {num(t3)}, "
                          f"{num(t1 if t1 > t3 else t1 + 2 * math.pi)})")
                        w(f"  {e}.StartPoint = {b}")
                        w(f"  {e}.EndPoint = {a}")
                elems.append((e, s))
            if "rect" in lp:  # H/V on all sides, driven lengths where the spec used parameters
                h0, v0, h1, v1 = lp["rect"]
                for i, (e, s) in enumerate(elems):
                    w(f"  cst.AddMonoEltCst {10 if i % 2 == 0 else 13}, part1.CreateReferenceFromObject({e})"
                      "  ' catCstTypeHorizontality / Verticality")
                for i, expr in ((0, f"abs(({h1}) - ({h0}))"), (1, f"abs(({v1}) - ({v0}))")):
                    if fs.is_expr(h0 if i == 0 else v0) or fs.is_expr(h1 if i == 0 else v1):
                        k = vb.uid("k")
                        w(f"  Set {k} = cst.AddMonoEltCst(5, part1.CreateReferenceFromObject({elems[i][0]}))"
                          "  ' catCstTypeLength")
                        w(f'  rels.CreateFormula "F_{label}_L{vb.n}", "", {k}.Dimension, "{formula(expr)}"')
        axl = None
        if axis is not None:
            (h0, v0), (h1, v1) = axis
            axl = vb.uid("axl")
            w(f"  Set {axl} = f2d.CreateLine({num(h0)}, {num(v0)}, {num(h1)}, {num(v1)})")
            w(f"  {axl}.Construction = True")
            w(f"  {sk}.CenterLine = {axl}")
        w(f"  {sk}.CloseEdition")
        w(f"  part1.InWorkObject = {sk}")
        w("  part1.Update")
        return sk

    for f in spec["features"]:
        t, label = f["type"], re.sub(r"\W", "_", f["name"])
        vb.step(f"{t} {label}")
        if t in ("pad", "pocket"):
            a, b = fs.ev(f["from"], P), fs.ev(f["to"], P)
            mid, half = (a + b) / 2, abs(b - a) / 2
            mid_expr = f"(({f['from']}) + ({f['to']})) / 2" if (fs.is_expr(f["from"]) or fs.is_expr(f["to"])) else None
            half_expr = f"abs(({f['to']}) - ({f['from']})) / 2" if mid_expr else None
            pl = plane_for(f["normal"], mid_expr, mid, label)
            sk = sketch(f["normal"], pl, mid, f["profile"], label)
            ft = vb.uid("ft")
            w(f"  Set {ft} = sf.AddNew{'Pad' if t == 'pad' else 'Pocket'}({sk}, {num(half)})")
            w(f"  {ft}.IsSymmetric = True")
            w(f'  {ft}.Name = "{label}"')
            if half_expr:
                w(f'  rels.CreateFormula "F_{label}_half", "", {ft}.FirstLimit.Dimension, '
                  f'"{formula(half_expr)}"')
        elif t in ("shaft", "groove"):
            off = fs.ev(f["offset"], P)
            pl = plane_for(f["normal"], f["offset"] if fs.is_expr(f["offset"]) else None, off, label)
            axis = [(fs.ev(p[0], P), fs.ev(p[1], P)) for p in f["axis"]]
            sk = sketch(f["normal"], pl, off, f["profile"], label, axis)
            first, second = (fs.ev(x, P) for x in f.get("angles", [360, 0]))
            ft = vb.uid("ft")
            w(f"  Set {ft} = sf.AddNew{'Shaft' if t == 'shaft' else 'Groove'}({sk})")
            w(f"  {ft}.FirstAngle.Value = {num(first)}")
            w(f"  {ft}.SecondAngle.Value = {num(second)}")
            w(f'  {ft}.Name = "{label}"')
        elif t == "mirror":
            off = fs.ev(f["offset"], P)
            pl = plane_for(f["normal"], f["offset"] if fs.is_expr(f["offset"]) else None, off, label)
            w("  part1.InWorkObject = body1")
            ft = vb.uid("ft")
            w(f"  Set {ft} = sf.AddNewMirror(part1.CreateReferenceFromObject({pl}))")
            w(f'  {ft}.Name = "{label}"')
        elif t == "manual":
            manual.append(f"{f['name']}: {f['note']}")
            continue
        else:
            raise ValueError(f"unknown feature type {t}")
        w("  part1.Update")
    vb.step("final update")
    w("  part1.Update")
    vb.step("done")
    w("  On Error GoTo 0")
    man = "".join(f'"- {m.replace(chr(34), chr(39))}" & vbCrLf & ' for m in manual) or '"(none)" & vbCrLf & '
    w(f'  msg = "{name}: built " & IIf(nFail = 0, "without errors", nFail & " step(s) failed") & vbCrLf & vbCrLf & '
      f'log & vbCrLf & "Manual steps (need edge picks):" & vbCrLf & {man}""')
    w("  MsgBox msg, 64, \"Reverse-engineering macro\"")
    w(f'  path = InputBox("Save the part as (.CATPart). Leave empty to skip.", "Save", "C:\\Temp\\{name}.CATPart")')
    w('  If path <> "" Then doc.SaveAs path')
    w("End Sub")
    w("")
    w("Function IIf(c, a, b)")
    w("  If c Then IIf = a Else IIf = b")
    w("End Function")
    return "\r\n".join(vb.lines) + "\r\n", manual


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    txt, manual = emit(fs.load(a.spec))
    Path(a.out).write_text(txt, encoding="utf-8")
    print(f"-> {a.out}  ({txt.count(chr(10))} lines, {len(manual)} manual step(s))")


if __name__ == "__main__":
    main()
