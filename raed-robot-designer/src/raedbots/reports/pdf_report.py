"""One-revision engineering summary as PDF (requirements, sizing, benchmark, checks, BOM)."""
from __future__ import annotations

from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from raedbots import __version__
from raedbots.branding import COPYRIGHT_NOTICE

INK = colors.HexColor("#14191c")
ACCENT = colors.HexColor("#2f7d4a")
RED = colors.HexColor("#c0392b")
AMBER = colors.HexColor("#b7791f")
GRID = colors.HexColor("#d5dcd9")
STATUS_COLOR = {"pass": ACCENT, "fail": RED, "unknown": AMBER, "not_applicable": colors.grey}


def _fmt(value, digits=2, unit=""):
    if value is None:
        return "—"
    if isinstance(value, (int, float)):
        return f"{value:.{digits}f}{(' ' + unit) if unit else ''}"
    return str(value)


def _table(rows, widths, header=True, status_col=None):
    styles = getSampleStyleSheet()
    cell = ParagraphStyle("cell", parent=styles["BodyText"], fontSize=7.5, leading=9.5)
    data = [[Paragraph(str(c), cell) for c in r] for r in rows]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    style = [
        ("GRID", (0, 0), (-1, -1), 0.4, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    if header:
        style += [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eef3f0"))]
    if status_col is not None:
        for r, row in enumerate(rows[1:], start=1):
            col = STATUS_COLOR.get(str(row[status_col]).lower())
            if col is not None:
                style.append(("TEXTCOLOR", (status_col, r), (status_col, r), col))
    t.setStyle(TableStyle(style))
    return t


def build_pdf(*, project: dict, revision_id: str, snapshot: dict, solver: dict, sizing: dict,
              benchmark: dict, bom: list[dict]) -> bytes:
    buf = BytesIO()
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=styles["Title"], alignment=0, fontSize=18, textColor=INK, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontSize=11.5, textColor=ACCENT, spaceBefore=10, spaceAfter=5)
    body = ParagraphStyle("b", parent=styles["BodyText"], fontSize=8.5, leading=11.5)
    note = ParagraphStyle("n", parent=body, fontSize=7.5, textColor=colors.HexColor("#5b6b70"))
    width = A4[0] - 30 * mm

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#6b7b80"))
        canvas.drawString(15 * mm, 9 * mm, f"RAED Robot Designer {__version__} · {COPYRIGHT_NOTICE} · "
                          f"For engineering review only — not approved for manufacturing")
        canvas.drawRightString(A4[0] - 15 * mm, 9 * mm, f"{revision_id} · page {doc.page}")
        canvas.restoreState()

    req = snapshot["requirements"]
    cfg = snapshot["configuration"]
    story = [
        Paragraph("RAED Dynamics · Robot Design Engineering Report", h1),
        Paragraph(f"Project <b>{project.get('name', '')}</b> · revision <b>{revision_id}</b> · "
                  f"snapshot {snapshot_hash(project, revision_id)[:16]}", body),
        Spacer(1, 6),
    ]

    story.append(Paragraph("1 · Requirements and selected configuration", h2))
    tool = "auto" if req.get("tool_choice") == "auto" else req.get("tool_choice")
    rows = [["Item", "Value", "Item", "Value"],
            ["Application", req["application"], "Robot family", cfg["family_id"]],
            ["Workpiece mass", _fmt(req["workpiece_mass_kg"]["value"], 1, "kg"), "Material", cfg["material_id"]],
            ["Specified payload", _fmt(req["payload_kg"]["value"], 1, "kg"), "End effector", cfg["tool_id"] + f" ({tool})"],
            ["Reach requirement", _fmt(req["reach_m"]["value"], 3, "m"), "Est. robot mass", _fmt(sizing["robot_mass_kg"], 1, "kg")],
            ["Cycle time target", _fmt(req["cycle_time_s"]["value"], 1, "s"), "Path time estimate", _fmt(solver.get("cycle_time_s"), 2, "s")]]
    story.append(_table(rows, [width * .22, width * .28, width * .22, width * .28]))

    story.append(Paragraph("2 · Actuator sizing (static worst case)", h2))
    rows = [["Axis", "Motor / reducer", "Worst static (N·m)", "Allowed cont. (N·m)", "Limited by",
             "Utilization", f"Required @ {req['payload_kg']['value']:.0f} kg (N·m)", "Static TCP cap. (kg)"]]
    for a in sizing["axes"]:
        util = a["utilization"]
        rows.append([a["axis"], f"{a['motor_id']} / {a['gearbox_id']} (i={a['ratio']:.0f})",
                     _fmt(a["worst_case_torque_nm"], 1), _fmt(a["allowed_continuous_nm"], 1), a["limited_by"],
                     "—" if util is None else f"{util * 100:.0f} %",
                     _fmt(a["required_static_nm_at_rated_payload"], 1), _fmt(a["static_tcp_capacity_kg"], 1)])
    story.append(_table(rows, [width * w for w in (.07, .25, .11, .11, .09, .1, .14, .13)]))
    story.append(Spacer(1, 3))
    story.append(Paragraph(
        f"Static payload capacity: <b>{_fmt(sizing['static_payload_capacity_kg'], 2, 'kg')}</b> "
        f"(limiting axis {sizing['limiting_axis'] or '—'}). Computed reach: wrist centre "
        f"<b>{_fmt(sizing['reach']['wrist_centre_m'], 3, 'm')}</b>, flange "
        f"<b>{_fmt(sizing['reach']['flange_m'], 3, 'm')}</b>. {sizing['scope']}", note))

    story.append(Paragraph("3 · Benchmark against RAED R-1 target and references", h2))
    rows = [["Robot", "Role", "Payload (kg)", "Reach (m)", "Mass (kg)", "Payload/mass", "Evidence"]]
    d = benchmark["design"]
    rows.append([d["name"], "design", _fmt(d["payload_kg"], 2), _fmt(d["reach_m"], 3), _fmt(d["mass_kg"], 1),
                 _fmt(d["payload_to_mass"], 3), d["evidence"]])
    for r in benchmark["references"]:
        rows.append([r["name"], r["role"], _fmt(r.get("payload_kg"), 2), _fmt(r.get("reach_m"), 3),
                     _fmt(r.get("mass_kg"), 1), _fmt(r.get("payload_to_mass"), 3), r["evidence"]])
    story.append(_table(rows, [width * w for w in (.24, .1, .11, .1, .1, .12, .23)]))
    story.append(Spacer(1, 4))
    rows = [["Target check", "Design", "Target", "Status", "Note"]]
    for g in benchmark["target_checks"]:
        rows.append([g["metric"], _fmt(g["design"], 2, g["unit"]), _fmt(g["target"], 2, g["unit"]), g["status"], g["note"]])
    story.append(_table(rows, [width * w for w in (.32, .13, .13, .1, .32)], status_col=3))
    story.append(Paragraph(benchmark["scope"], note))

    story.append(Paragraph("4 · Engineering checks", h2))
    rows = [["Check", "Status", "Method", "Reasons"]]
    for c in solver["checks"]:
        rows.append([c["name"], c["status"], c["method"], "; ".join(c.get("reasons") or [])])
    story.append(_table(rows, [width * w for w in (.22, .1, .43, .25)], status_col=1))

    story.append(Paragraph("5 · Bill of materials", h2))
    rows = [["Part", "Description", "Make/Buy", "Qty", "CAD", "Unit cost"]]
    for b in bom:
        cost = "Unknown" if b.get("unit_cost") is None else f"{b['unit_cost']} {b.get('currency') or ''}"
        rows.append([b["part_number"], b["description"], b["make_buy"], b["qty"], b.get("cad_match") or "—", cost])
    story.append(_table(rows, [width * w for w in (.18, .4, .09, .06, .14, .13)]))

    story.append(KeepTogether([
        Paragraph("6 · Limitations", h2),
        Paragraph("Static gravity screening only: dynamic torque, deflection, thermal behaviour, cable routing and "
                  "physical accuracy remain unverified. Reference robot values are public, unverified metadata. "
                  "Unknown values are reported as unknown rather than estimated.", body),
    ]))

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm,
                            bottomMargin=16 * mm, title=f"RAED engineering report {revision_id}",
                            author=COPYRIGHT_NOTICE)
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


def snapshot_hash(project: dict, revision_id: str) -> str:
    return project.get("snapshots", {}).get(revision_id, {}).get("hash", "")
