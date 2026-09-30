"""Toolmaker-style DFM.pptx from dfm_summary.json written by run_dfm_offline.py (any part, no CAD libraries).

    python deck_offline.py outputs/dfm            # reads outputs/dfm/dfm_summary.json -> outputs/dfm/DFM.pptx

Needs python-pptx, Pillow and matplotlib (for toolmaker_ppt). Same format as the full pipeline: numbered
slides, green renders, red call-outs, CAV/COR indicator and an EMPTY RESULT/APPD/DATE table on every slide.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from toolmaker_ppt import (GREY, RED, W, H, CategoryChartData, Inches, PP_ALIGN, Presentation, Pt,  # noqa: E402
                           XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION, box, cavcor, comment,
                           crop_to_content, label, line, new, note, pic, to_3d_pie, txt)

PROXY = "estimate, geometric proxy, not Moldflow"


def build(d: Path, out: Path | None = None):
    d = Path(d)
    S = json.loads((d / "dfm_summary.json").read_text())
    F = {k: d / v for k, v in S["figures"].items()}
    FIG = d / "figures"
    out = out or d / "DFM.pptx"
    prs = Presentation()
    prs.slide_width, prs.slide_height = Inches(W), Inches(H)
    part, geo, th, dr = S["part"], S["geometry"], S["thickness"], S["draft"]
    cool, mold, ej = S["cooling"], S["mold"], S["ejection"]
    n = [0]

    def title(t):
        n[0] += 1
        return f"{n[0]}.{t}"

    def img(s, key, x, y, w, h):
        c, off = crop_to_content(F[key])
        mp, rect = pic(s, c, x, y, w, h)
        return (lambda px, py: mp(px - off[0], py - off[1])), rect

    uc = S["undercuts"]["clusters"]
    actions = [u for u in uc if u["action"] in ("slider", "lifter")]
    n_slider = sum(u["action"] == "slider" for u in actions)
    n_lifter = sum(u["action"] == "lifter" for u in actions)

    # ---------------------------------------------------------------- 1 product / tooling information
    s = new(prs)
    txt(s, 0.3, 0.75, 3.8, 0.35, "Product information", size=13, color=RED, underline=True, align=PP_ALIGN.CENTER)
    info = [f"Part Name :- {part['name']}", f"Index No :- {part['code']}", f"Model :- {part['model']}",
            f"Plastic material :- {part['material']}" + ("  (assumed)" if part["material_assumed"] else ""),
            f"Shrinkage :- {part['shrinkage']:.3f}", f"Part Weight :- {geo['mass_g']:.2f}g"]
    for i, t in enumerate(info):
        txt(s, 0.2, 1.3 + 0.48 * i, 4.2, 0.35, t, size=12)
    line(s, 4.55, 0.6, 4.55, 6.3, width=1.5)
    txt(s, 4.8, 0.75, 4.8, 0.35, "Tooling information", size=13, color=RED, underline=True, align=PP_ALIGN.CENTER)
    gate_type = "PINPOINT GATE" if "pin" in S["gate"]["pick"] else "SIDE GATE"
    tool = ["Tooling type :-  " + ("3PLATE" if "pin" in S["gate"]["pick"] else "2PLATE"), "Hot Runner system :- NONE",
            f"Gate type :- {gate_type}", f"No. of cavities :- 1 X {S['cavity_pick']}",
            f"No. of slider :- {f'{n_slider}X / CAV' if n_slider else 'NONE'}",
            f"No. of lifters :- {f'{n_lifter}X / CAV' if n_lifter else 'NONE'}", "Main insert material :- NAK-80",
            "Mold base material :- S50C", "Mold base Standard :- LKM",
            f"Injection machine capacity :-  {mold['machine_t']}T"]
    for i, t in enumerate(tool):
        txt(s, 4.8, 1.3 + 0.48 * i, 5.0, 0.35, t, size=12)
    note(s, ("Material not given: assumed, typical datasheet values. " if part["material_assumed"] else "") +
         "Weight = mesh volume x density. Tooling data = proposal from this analysis.", y=6.35)

    # ---------------------------------------------------------------- 2 product size
    s = new(prs, "Product size")
    sz = geo["size_work_LWH"]
    _, (ox, oy, pw, ph) = img(s, "part_cav_plan", 0.35, 0.8, 7.4, 3.5)
    _, (ox2, oy2, pw2, ph2) = img(s, "part_side", 0.35, 4.7, 7.4, 1.5)
    line(s, ox, oy + ph + 0.12, ox + pw, oy + ph + 0.12, arrow_end=True, arrow_start=True)
    label(s, ox + pw / 2 - 0.4, oy + ph + 0.0, f"{sz['Z']:.2f}", w=0.8)  # cav_plan: Z across, X up
    line(s, ox + pw + 0.15, oy, ox + pw + 0.15, oy + ph, arrow_end=True, arrow_start=True)
    label(s, ox + pw + 0.25, oy + ph / 2 - 0.13, f"{sz['X']:.2f}", w=0.8)
    line(s, ox2 + pw2 + 0.15, oy2, ox2 + pw2 + 0.15, oy2 + ph2, arrow_end=True, arrow_start=True)
    label(s, ox2 + pw2 + 0.25, oy2 + ph2 / 2 - 0.13, f"{sz['Y_pull']:.2f}", w=0.8)
    txt(s, 0.35, 4.35, 4, 0.3, "Cavity side (plan)", size=9, color=GREY)
    txt(s, 0.35, 6.25, 4, 0.3, "Side view (pull direction up)", size=9, color=GREY)

    # ---------------------------------------------------------------- parting line
    s = new(prs, title("Parting Line"))
    cavcor(s, 0.72, 0.5, pl=True)
    img(s, "pl_side", 1.45, 0.62, 8.3, 1.3)
    img(s, "pl_cav_iso", 0.3, 2.05, 4.6, 4.4)
    img(s, "pl_core_iso", 5.0, 2.05, 4.8, 4.4)
    steps = S["pl"]["steps"]
    comment(s, 2.45, 6.62, 7.35, 0.62,
            [f"PL (red) at pull height {S['pl']['y_work']:.2f} ({S['pl']['method']}). "
             + (f"{len(steps)} PL step(s) found: " + "; ".join(f"{p['where']} dY {p['dy']:+.1f}" for p in steps)
                if steps else "Flat PL.")], size=10)
    for p in steps[:3]:
        s = new(prs, title("Parting Line"))
        cavcor(s)
        mp, _ = img(s, "pl_core_iso", 0.3, 0.6, 5.0, 5.8)
        if "px" in p:
            x, y = mp(*p["px"])
            box(s, x - 0.35, y - 0.35, 0.7, 0.7)
            line(s, x + 0.35, y, 5.5, 3.2, width=1.0)
        comment(s, 5.5, 2.4, 4.3, 1.6, [f"PL step {p['dy']:+.2f} mm at {p['where']}",
                                        "xyz " + ", ".join(f"{v:.1f}" for v in p["xyz"]),
                                        "Shut-off: min 5º side angle, confirm in CAD"], size=10)

    # ---------------------------------------------------------------- slider / lifter
    if actions:
        s = new(prs, title("Slider" if n_slider and not n_lifter else ("Lifter" if n_lifter and not n_slider
                                                                        else "Slider & Lifter")))
        cavcor(s)
        mp, _ = img(s, "uc_core_iso", 0.3, 0.6, 6.2, 5.8)
        for i, u in enumerate(actions):
            f = next((f for f in S["findings"] if f["type"] == "undercut" and f["xyz"] == u["xyz"]), None)
            if f and "px" in f and f.get("view") == "core_iso":
                x, y = mp(*f["px"])
                box(s, x - 0.25, y - 0.25, 0.5, 0.5)
                label(s, x + 0.3, y - 0.4, f"{u['action'].title()} {i + 1:02d}", size=9, w=0.95, h=0.24)
        comment(s, 6.7, 1.0, 3.1, 3.2,
                [f"{u['action'].title()} {i + 1:02d}: {u['where']}, move {u['side_release']['sign']:+d}"
                 f"{u['side_release']['axis']} ({u['side_release']['free_pct']:.0f}% free)" for i, u in enumerate(actions)][:8]
                + ([f"+{len(actions) - 8} more in dfm_summary.json"] if len(actions) > 8 else []), size=9)
        note(s, "Undercut faces red. Release checked over the feature length only (analysis frame, pull = +Y).",
             y=6.4)

    # ---------------------------------------------------------------- ejector
    s = new(prs, title("Ejector"))
    mp, _ = img(s, "ej_core_plan", 0.3, 0.6, 6.4, 5.9)
    ys = 0.9
    for dia, cnt in ej["sizes"].items():
        label(s, 7.0, ys, f"EP {float(dia):.1f} ( {cnt}X )", size=11, w=1.9)
        ys += 0.4
    comment(s, 6.9, ys + 0.3, 2.9, 1.9, [f"{len(ej['pins'])} pins on flat core pads (checked).",
                                          f"Core depth {ej['core_depth_mm']:.1f} mm, ejector stroke "
                                          f"{ej['stroke_mm']:.1f} mm.", "No pins in lifter / slider zones."], size=10)
    note(s, "Proposal: pad flatness verified by rays; add blades on thin ribs if the toolmaker prefers.", y=6.4)

    # ---------------------------------------------------------------- gate
    s = new(prs, title("Gate"))
    mp, _ = img(s, "fill_cav_iso", 0.3, 0.6, 5.2, 4.2)
    gpx = S["px"]["gate"]["cav_iso"]
    x, y = mp(*gpx)
    box(s, x - 0.2, y - 0.2, 0.4, 0.4)
    label(s, x + 0.25, y - 0.45, "Gate", size=10, w=0.6)
    rows = S["gate"]["candidates"]
    t = s.shapes.add_table(len(rows) + 1, 3, Inches(5.7), Inches(0.8), Inches(4.1), Inches(0.28 * (len(rows) + 1))).table
    for c, h in enumerate(("Candidate", "Max flow mm", "L/t")):
        t.cell(0, c).text = h
    for r, g in enumerate(rows, 1):
        for c, v in enumerate((g["name"] + (" ←" if g["name"] == S["gate"]["pick"] else ""),
                               f"{g['max_flow_mm']:.0f}", f"{g['L_t']:.0f}")):
            t.cell(r, c).text = v
    for r in range(len(rows) + 1):
        for c in range(3):
            for p in t.cell(r, c).text_frame.paragraphs:
                for run in p.runs:
                    run.font.size = Pt(9)
    label(s, 5.7, 0.95 + 0.28 * (len(rows) + 1), "Cold Runner + " + ("Pin point Gate" if "pin" in S["gate"]["pick"]
                                                                       else "Side Gate"), size=11, w=3.0)
    gp = next(g for g in rows if g["name"] == S["gate"]["pick"])
    comment(s, 0.4, 5.0, 9.4, 0.9, [f"Gate at {gp['name']}: max flow length {gp['max_flow_mm']:.0f} mm, "
                                     f"L/t {gp['L_t']:.0f} (shortest among the PL gates).",
                                     S["gate"]["note"]], size=10)
    note(s, PROXY + ": flow length over the part surface.", y=6.4)

    # ---------------------------------------------------------------- draft
    s = new(prs, title("Draft angle analysis"))
    img(s, "draft_cav_iso", 0.25, 0.6, 4.3, 4.6)
    img(s, "draft_core_iso", 4.6, 0.6, 4.3, 4.6)
    pic(s, FIG / "legend_draft.png", 9.05, 1.0, 0.8, 2.8)
    comment(s, 0.6, 5.35, 8.8, 0.7, [(f"All green surface are 0º ({dr['zero_draft_area_mm2']:.0f} mm²), propose "
                                      "to add 1.0º for cavity side & draft 0.5º for core side",
                                      {"bold": True, "color": RED})], size=11)
    b = dr["bands_pct"]
    note(s, "Area share: " + ", ".join(f"{k} deg {v:.1f}%" for k, v in b.items()) + " (measured).", y=6.2)

    # ---------------------------------------------------------------- thickness
    s = new(prs, title("Thickness mark"))
    img(s, "thick_cav_iso", 0.25, 0.6, 4.3, 4.6)
    img(s, "thick_core_iso", 4.6, 0.6, 4.3, 4.6)
    pic(s, FIG / "legend_thick.png", 9.05, 1.0, 0.8, 2.8)
    spots = th["thick_spots"]
    comment(s, 0.6, 5.35, 8.8, 0.8,
            [(f"Red surface have thickness mark (> {th['thick_threshold']:.2f} mm)" if spots else
              "No serious thickness mark", {"bold": True, "color": RED}),
             f"Nominal {th['nominal_median']:.2f} mm, min {th['min_0.5pct']:.2f}, max {th['max_99.5pct']:.2f} mm "
             "(0.5 / 99.5 %, measured)"], size=11)

    # ---------------------------------------------------------------- suggest slides
    for f in S["findings"]:
        s = new(prs, title("Suggest"))
        cavcor(s)
        if f.get("zoom"):
            base = "part_" + f["view"]
            mp, _ = img(s, base, 0.25, 0.6, 4.5, 5.0)
            x, y = mp(*f["px"])
            box(s, x - 0.3, y - 0.3, 0.6, 0.6)
            _, (zx, zy, zw, zh) = img(s, f["zoom"], 5.0, 0.9, 4.8, 3.6)
            box(s, zx, zy, zw, zh, dashed=True, width=1.0)
            line(s, x + 0.3, y, zx, zy + zh / 2, width=1.0)
            label(s, zx + 0.1, zy + 0.1, f["type"].title() if f["type"] != "sharp steel" else "Sharp steel",
                  size=10)
        else:
            img(s, "draft_cav_iso", 0.25, 0.6, 4.5, 5.0)
            img(s, "draft_core_iso", 5.0, 0.6, 4.6, 4.2)
        comment(s, 2.45, 5.75, 7.35, 0.8, [f["text"]], size=11)
        loc = "" if f["xyz"] is None else " at xyz " + ", ".join(f"{v:.1f}" for v in f["xyz"])
        note(s, f"{f['where']}{loc} (CAD frame). Change: {f['change']}", y=6.6)

    # ---------------------------------------------------------------- mold layout
    s = new(prs, title("Mold Layout"))
    fig_mold_generic(S, FIG / "mold_layout.png")
    _, (ox, oy, pw, ph) = pic(s, FIG / "mold_layout.png", 0.3, 0.6, 5.6, 5.8)
    label(s, 6.1, 0.9, f"Mold {mold['mold_W_mm']:.0f} X {mold['mold_L_mm']:.0f}", size=11, w=2.3)
    label(s, 6.1, 1.35, f"Insert {mold['insert_W_mm']:.0f} X {mold['insert_L_mm']:.0f}", size=11, w=2.3)
    label(s, 6.1, 1.8, f"{mold['machine_t']} TON", size=11, w=1.2, bold=True)
    txt(s, 6.1, 2.3, 3.7, 0.5, f"Distance between tie rods (HXV) {mold['tie_bar_mm']} X {mold['tie_bar_mm']}", size=10)
    rows_ = S["tonnage"]
    lines_ = [f"{r['cavities']} cav: {r['clamp_calc_t']:.0f} t calc, shot {r['shot_g']:.0f} g, {r['parts_per_h']} pcs/h"
              for r in rows_]
    txt(s, 6.1, 2.9, 3.7, 1.4, lines_, size=10)
    if mold["upsized"]:
        comment(s, 6.1, 4.4, 3.7, 0.7, [(f"Machine size need to change from {mold['machine_t_clamp']}T to "
                                         f"{mold['machine_t']}T", {"bold": True, "color": RED})], size=11)
    note(s, "Hand-calculated: F = n(A_part + A_runner) x p x 1.2; mould size = estimate; tie bars = typical, "
            "confirm with the moulder.", y=6.4)

    # ---------------------------------------------------------------- fill time
    cy = cool["cycle"]
    s = new(prs, title("Fill Time"))
    img(s, "fill_cav_iso", 0.25, 0.6, 4.3, 4.8)
    img(s, "fill_core_iso", 4.6, 0.6, 4.3, 4.8)
    pic(s, FIG / "legend_fill.png", 9.05, 1.0, 0.8, 2.8)
    comment(s, 2.45, 5.55, 7.35, 0.55, [(f"Filling time = {cy['fill_s']:.2f}sec (estimate)",
                                          {"bold": True, "color": RED, "size": 13})])
    note(s, PROXY + ": flow length from the gate (mm); fill time = shot volume / 40 cm3/s (assumed rate).", y=6.3)

    s = new(prs, title("Ejection Temperature"))
    img(s, "ejt_core_iso", 0.25, 0.6, 5.2, 5.0)
    pic(s, FIG / "legend_ejt.png", 5.6, 0.8, 0.8, 3.0)
    comment(s, 6.5, 1.0, 3.3, 2.0, [f"Time to reach ejection temperature: median {S['ejection_time_s']['p50']:.1f} s, "
                                    f"p99 {S['ejection_time_s']['p99']:.1f} s.",
                                    f"Governing wall {cool['governing_wall_mm']:.2f} mm."], size=10)
    note(s, "estimate, 1-D plate cooling per local thickness (hand-calculated), not Moldflow.", y=6.4)

    s = new(prs, title("Air Traps"))
    img(s, "air_core_iso", 0.25, 0.6, 4.3, 5.0)
    img(s, "air_cav_iso", 4.6, 0.6, 4.4, 5.0)
    comment(s, 2.45, 5.75, 7.35, 0.55, [("Make air vent around parts (last-fill points: red)" if S["air_traps"] else
                                          "Not serious air traps", {"bold": True, "color": RED, "size": 12})])
    note(s, PROXY + ": local maxima of flow length from the gate.", y=6.4)

    s = new(prs, title("Weld Lines"))
    img(s, "weld_cav_iso", 0.25, 0.6, 4.3, 5.0)
    img(s, "weld_core_iso", 4.6, 0.6, 4.4, 5.0)
    comment(s, 2.45, 5.75, 7.35, 0.55, [("Weld lines where flow fronts meet (red); check cosmetic side"
                                          if S["weld_lines"] else "Not serious weld line",
                                          {"bold": True, "color": RED, "size": 11})])
    note(s, PROXY + ": edges where the flow-front directions oppose.", y=6.4)

    # ---------------------------------------------------------------- cycle time
    s = new(prs, title("Cycle Time"))
    cd = CategoryChartData()
    cd.categories = ["Fill time", "Pack time", "Cooling time", "Mold open time"]
    cd.add_series("s", (cy["fill_s"], cy["pack_s"], cy["cool_s"], cy["mold_open_s"]))
    gf = s.shapes.add_chart(XL_CHART_TYPE.PIE, Inches(0.3), Inches(0.7), Inches(4.6), Inches(3.8), cd)
    ch = gf.chart
    ch.has_title = False
    ch.has_legend = True
    ch.legend.position = XL_LEGEND_POSITION.BOTTOM
    ch.legend.include_in_layout = False
    ch.legend.font.size = Pt(9)
    pl_ = ch.plots[0]
    pl_.has_data_labels = True
    pl_.data_labels.number_format = '0.0"s"'
    pl_.data_labels.number_format_is_linked = False
    pl_.data_labels.font.size = Pt(9)
    pl_.data_labels.position = XL_LABEL_POSITION.OUTSIDE_END
    to_3d_pie(ch)
    img(s, "part_cav_iso", 5.2, 0.6, 4.6, 2.6)
    txt(s, 5.2, 3.35, 4.6, 1.3, [f"1.Fill time = {cy['fill_s']:.3f}sec", f"2.Pack time = {cy['pack_s']:.1f} sec",
                                 f"3.Cooling time = {cy['cool_s']:.1f} sec", f"4.Mold open time = {cy['mold_open_s']:.1f} sec"],
        size=12)
    txt(s, 0.4, 4.75, 9.4, 0.4, [[("Cycle time = Fill + Pack + Cooling + Mold open = ", {}),
                                  (f"{cy['total_s']:.3f} sec", {"color": RED, "underline": True, "bold": True})]], size=14)
    note(s, f"Cooling hand-calculated (1-D plate, {part['material']}, {cool['governing_wall_mm']:.2f} mm = 99.5 % of the "
            "part); fill = estimate; pack 8.0 s and mold open 5.0 s = supplier defaults.", y=5.3)
    prs.save(out)
    return out


def fig_mold_generic(S, out):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Circle, Rectangle

    M, g = S["mold"], S["geometry"]["size_work_LWH"]
    n = S["cavity_pick"]
    mw, ml_, iw, il = M["mold_W_mm"], M["mold_L_mm"], M["insert_W_mm"], M["insert_L_mm"]
    pw, pl = g["X"], g["Z"]
    fig, ax = plt.subplots(figsize=(5.4, 5.6))
    ax.add_patch(Rectangle((-mw / 2 - 25, -ml_ / 2), mw + 50, ml_, fc="#4F81BD", ec="k"))
    ax.add_patch(Rectangle((-mw / 2, -ml_ / 2), mw, ml_, fc="#FFE45C", ec="k"))
    ax.add_patch(Rectangle((-iw / 2, -il / 2), iw, il, fc="#BFE3F5", ec="k"))
    x0 = -(n * pw + 30 * (n - 1)) / 2
    for i in range(n):
        ax.add_patch(Rectangle((x0 + i * (pw + 30), -pl / 2), pw, pl, fc="#3DBE3D", ec="#1a5c1a"))
    for cx in (-mw / 2 + 25, mw / 2 - 25):
        for cy in (-ml_ / 2 + 25, ml_ / 2 - 25):
            ax.add_patch(Circle((cx, cy), 10, fc="#DDDDDD", ec="k"))
    for yy in (-0.3 * il, 0, 0.3 * il):
        ax.plot([-mw / 2 - 25, mw / 2 + 25], [yy, yy], color="#1f77b4", lw=1.2, ls=":")
    ax.text(0, ml_ / 2 + 12, "Mold Top", ha="center", fontsize=10, color="red")
    ax.set_xlim(-mw / 2 - 45, mw / 2 + 45)
    ax.set_ylim(-ml_ / 2 - 25, ml_ / 2 + 30)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.savefig(out, dpi=170, bbox_inches="tight", facecolor="white")
    plt.close(fig)


if __name__ == "__main__":
    p = build(Path(sys.argv[1] if len(sys.argv) > 1 else "."))
    print("deck ->", p)
