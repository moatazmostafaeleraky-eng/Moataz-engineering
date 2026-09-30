"""Example: a reverse-engineered moulded snap-fit cover (design-intent version) written as a feature spec.
Box-like features are parameter expressions (edit a parameter in CATIA -> the part follows); the revolved thumb
recess profile is computed here from its parameters and written as coordinates.

    python make_cover_spec_example.py cover_spec_example.json
"""

import json
import math
import sys

P = {
    "WIDTH": 31.0, "Z_BOTTOM": 11.5, "Z_TOP": 77.0, "Y_OUTER": 20.0, "WALL": 2.0, "TOP_EDGE_R": 0.5,
    "Y_RIB_TIP": 16.0, "OVERLAP": 0.5, "RAIL_W": 1.0, "RAIL_Z0": 26.5, "RAIL_Z1": 75.5, "RIB_W": 0.8,
    "RIB_X1": 7.0, "RIB_X2": 24.0, "RIB_Z1": 56.5, "LIP_Z1": 76.5,
    "HOOK_X0": 12.5, "HOOK_X1": 18.5, "HOOK_Y1": 17.0, "HOOK_Z0": 68.5, "HOOK_Z1": 73.0, "HOOK_LEG_W": 1.0,
    "BUMP_W": 3.0, "BUMP_X1": 6.0, "BUMP_X2": 25.0, "CORE_W": 1.0,
    "LATCH_X0": 12.5, "LATCH_X1": 18.5,
}
Y_IN = "Y_OUTER - WALL + OVERLAP"  # inner features overlap 0.5 mm into the plate
s45 = math.sqrt(0.5)


def rect_x(name, x0, x1, y0, y1, z0, z1):
    return {"type": "pad", "name": name, "normal": "X", "from": x0, "to": x1, "profile": {"rect": [y0, z0, y1, z1]}}


def main(out):
    F = []
    # plate: (y, z) profile with the rounded top end, extruded across the width
    r, zt, yo, yi = P["TOP_EDGE_R"], P["Z_TOP"] - P["TOP_EDGE_R"], P["Y_OUTER"], P["Y_OUTER"] - P["WALL"]
    F.append({"type": "pad", "name": "Plate", "normal": "X", "from": 0, "to": "WIDTH", "profile": {"path": {
        "start": [yi, P["Z_BOTTOM"]], "segs": [
            {"line": [yo, P["Z_BOTTOM"]]}, {"line": [yo, zt]},
            {"arc": {"mid": [yo - r + r * s45, zt + r * s45], "end": [yo - r, P["Z_TOP"]]}},
            {"line": [yi + r, P["Z_TOP"]]},
            {"arc": {"mid": [yi + r - r * s45, zt + r * s45], "end": [yi, zt]}}]}}})
    F += [rect_x("Rail_L", 0, "RAIL_W", "Y_RIB_TIP", Y_IN, "RAIL_Z0", "RAIL_Z1"),
          rect_x("Rail_R", "WIDTH - RAIL_W", "WIDTH", "Y_RIB_TIP", Y_IN, "RAIL_Z0", "RAIL_Z1"),
          rect_x("Top_lip", 0, "WIDTH", "Y_RIB_TIP", Y_IN, "RAIL_Z1", "LIP_Z1"),
          rect_x("Hook_block", "HOOK_X0", "HOOK_X1", "Y_RIB_TIP", "HOOK_Y1", "HOOK_Z0", "HOOK_Z1"),
          rect_x("Hook_leg_L", "HOOK_X0", "HOOK_X0 + HOOK_LEG_W", "Y_RIB_TIP", Y_IN, "HOOK_Z1", "RAIL_Z1"),
          rect_x("Hook_leg_R", "HOOK_X1 - HOOK_LEG_W", "HOOK_X1", "Y_RIB_TIP", Y_IN, "HOOK_Z1", "RAIL_Z1"),
          rect_x("Rib_1", "RIB_X1 - RIB_W/2", "RIB_X1 + RIB_W/2", "Y_RIB_TIP", Y_IN, "RAIL_Z0", "RIB_Z1"),
          rect_x("Rib_2", "RIB_X2 - RIB_W/2", "RIB_X2 + RIB_W/2", "Y_RIB_TIP", Y_IN, "RAIL_Z0", "RIB_Z1")]
    # bumps on the outer face (end radius 2 in the sketch), then the coring pockets from inside
    z0, z1, br, bh = 68.5, 75.5, 2.0, 22.0
    bump = {"path": {"start": [19.5, z0], "segs": [
        {"line": [yo, z0]}, {"arc": {"mid": [yo + br * s45, z0 + br - br * s45], "end": [bh, z0 + br]}},
        {"line": [bh, z1 - br]}, {"arc": {"mid": [yo + br * s45, z1 - br + br * s45], "end": [yo, z1]}},
        {"line": [19.5, z1]}]}}
    for i, xc in ((1, "BUMP_X1"), (2, "BUMP_X2")):
        F.append({"type": "pad", "name": f"Bump_{i}", "normal": "X", "from": f"{xc} - BUMP_W/2",
                  "to": f"{xc} + BUMP_W/2", "profile": bump})
    c0, c1, cr, ct, yb = 69.5, 74.5, 0.5, 21.0, 17.5
    core = {"path": {"start": [yb, c0], "segs": [
        {"line": [ct - cr, c0]}, {"arc": {"mid": [ct - cr + cr * s45, c0 + cr - cr * s45], "end": [ct, c0 + cr]}},
        {"line": [ct, c1 - cr]}, {"arc": {"mid": [ct - cr + cr * s45, c1 - cr + cr * s45], "end": [ct - cr, c1]}},
        {"line": [yb, c1]}]}}
    for i, xc in ((1, "BUMP_X1"), (2, "BUMP_X2")):
        F.append({"type": "pocket", "name": f"Bump_core_{i}", "normal": "X", "from": f"{xc} - CORE_W/2",
                  "to": f"{xc} + CORE_W/2", "profile": core})
    # snap latch (side profile)
    y0, y1 = 13.0, 14.3
    F.append({"type": "pad", "name": "Latch", "normal": "X", "from": "LATCH_X0", "to": "LATCH_X1", "profile": {
        "poly": [[y0, 5.5], [y0 + 1.0, 5.5], [15.0, 9.0], [15.0, 9.5], [y1, 9.5], [y1, 11.5], [19.0, 11.5],
                 [19.0, 13.1 + (19.0 - y0) * 1.2], [y0, 13.1]]}})
    # thumb recess: revolved about an axis parallel to Y through (X 15.5, Z 11.5); sketched on the plane X = 15.5
    ax_z, a, arc_r, rim_r, floor_y, W = 11.5, 2.55, 7.1, 1.25, 18.0, P["WALL"]
    c1_ = (a, floor_y + arc_r)
    dy = c1_[1] - (yo - rim_r)
    c2_ = (a + math.sqrt((arc_r + rim_r) ** 2 - dy ** 2), yo - rim_r)
    k = arc_r / (arc_r + rim_r)
    t = (c1_[0] + (c2_[0] - c1_[0]) * k, c1_[1] + (c2_[1] - c1_[1]) * k)
    r_i = arc_r + W
    r_end = a + math.sqrt(r_i ** 2 - (c1_[1] - (yo - W)) ** 2)

    def pt(rr, y):  # (r, y) -> sketch (h, v) = (Y, Z)
        return [round(y, 6), round(ax_z + rr, 6)]

    def mid(c, rad, a0, a1):
        m = (a0 + a1) / 2
        return c[0] + rad * math.cos(m), c[1] + rad * math.sin(m)

    a1s, a1e = -math.pi / 2, math.atan2(t[1] - c1_[1], t[0] - c1_[0])
    a2s, a2e = math.atan2(t[1] - c2_[1], t[0] - c2_[0]), math.pi / 2
    outer = [{"arc": {"mid": pt(*mid(c1_, arc_r, a1s, a1e)), "end": pt(*t)}},
             {"arc": {"mid": pt(*mid(c2_, rim_r, a2s, a2e)), "end": pt(c2_[0], yo)}}]
    outer_rev = [{"arc": {"mid": pt(*mid(c2_, rim_r, a2s, a2e)), "end": pt(*t)}},
                 {"arc": {"mid": pt(*mid(c1_, arc_r, a1s, a1e)), "end": pt(a, floor_y)}}]
    axis = [[0, ax_z], [30, ax_z]]
    air = {"path": {"start": pt(0, floor_y), "segs": [{"line": pt(a, floor_y)}] + outer + [
        {"line": pt(12, yo)}, {"line": pt(12, 24)}, {"line": pt(0, 24)}]}}
    F.append({"type": "groove", "name": "Thumb_recess", "normal": "X", "offset": 15.5, "axis": axis,
              "angles": [360, 0], "profile": air})
    for i, (x0, x1) in enumerate(((13.5, 15.0), (16.0, 17.5)), 1):
        F.append({"type": "pocket", "name": f"Latch_slot_{i}", "normal": "X", "from": x0, "to": x1,
                  "profile": {"rect": [12.0, 12.5, "Y_OUTER - WALL", 21.5]}})
    a_e = math.atan2((yo - W) - c1_[1], r_end - c1_[0])
    shell = {"path": {"start": pt(0, floor_y - W), "segs": [
        {"line": pt(a, floor_y - W)},
        {"arc": {"mid": pt(*mid(c1_, r_i, -math.pi / 2, a_e)), "end": pt(r_end, yo - W)}},
        {"line": pt(r_end, yo)}, {"line": pt(c2_[0], yo)}] + outer_rev + [{"line": pt(0, floor_y)}]}}
    F.append({"type": "shaft", "name": "Recess_shell", "normal": "X", "offset": 15.5, "axis": axis,
              "angles": [90, 90], "profile": shell})
    F.append({"type": "manual", "name": "Bump_edge_fillets",
              "note": "Edge fillet R0.25 on the 4 proud side edges of each bump (X faces, above the plate)"})
    spec = {"part": "cover_example", "params": P, "features": F}
    open(out, "w").write(json.dumps(spec, indent=1))
    print("->", out, len(F), "features")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "cover_spec_example.json")
