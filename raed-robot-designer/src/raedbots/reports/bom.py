from __future__ import annotations

from raedbots.cad.geometry import part_boxes
from raedbots.catalog import loader
from raedbots.domain.models import BomLine, CadMatch, MakeBuy, RobotConfiguration, SolverResult


def build_bom(cfg: RobotConfiguration, sol: SolverResult) -> list[BomLine]:
    tool = loader.tools()[cfg.tool_id]
    mat = loader.materials()[cfg.material_id]
    lines: list[BomLine] = []
    n = 1
    lines.append(
        BomLine(
            item=n,
            parent=None,
            part_number="RB-ASSY-001",
            revision="A",
            description=f"Robot assembly {cfg.family_id}",
            make_buy=MakeBuy.MAKE,
            qty=1,
            unit="ea",
            mass_kg=sol.robot_mass_kg,
            status="draft",
        )
    )
    n += 1
    for p in part_boxes(cfg):
        lines.append(
            BomLine(
                item=n,
                parent="RB-ASSY-001",
                part_number=p["part_number"],
                revision="A",
                description=p["name"],
                make_buy=MakeBuy.MAKE,
                qty=1,
                unit="ea",
                material=mat.name,
                cad=f"CAD/Manufactured_Parts/{p['part_number']}_A.step",
                cad_match=CadMatch.ENVELOPE,
            )
        )
        n += 1
    used = {}
    for ax in cfg.axes:
        for cid in (ax.motor_id, ax.gearbox_id, ax.bearing_id):
            used[cid] = used.get(cid, 0) + 1
    catalog = {**loader.motors(), **loader.gearboxes(), **loader.bearings(), **loader.fasteners()}
    for cid, qty in used.items():
        c = catalog[cid]
        lines.append(
            BomLine(
                item=n,
                parent="RB-ASSY-001",
                part_number=f"BUY-{cid.upper()}",
                revision="A",
                description=c.description,
                make_buy=MakeBuy.BUY,
                qty=qty,
                unit="ea",
                manufacturer=c.manufacturer,
                model=c.model,
                mass_kg=c.mass_kg,
                unit_cost=c.unit_cost,
                currency=c.currency,
                cad_match=c.cad_status if c.cad_file else CadMatch.MISSING,
                notes=c.data_source,
            )
        )
        n += 1
    lines.append(
        BomLine(
            item=n,
            parent="RB-ASSY-001",
            part_number="BUY-ISO4762-M6X20",
            revision="A",
            description="ISO 4762 M6x20",
            make_buy=MakeBuy.BUY,
            qty=24,
            unit="ea",
            manufacturer="ISO",
            model="ISO 4762 M6x20",
            mass_kg=0.008,
            cad_match=CadMatch.MISSING,
        )
    )
    n += 1
    lines.append(
        BomLine(
            item=n,
            parent="RB-ASSY-001",
            part_number=f"EE-{tool.id.upper()}",
            revision=tool.revision,
            description=tool.name,
            make_buy=MakeBuy.BUY,
            qty=1,
            unit="ea",
            manufacturer=tool.manufacturer,
            model=tool.model,
            mass_kg=tool.mass_kg,
            cad_match=CadMatch.ENVELOPE,
            notes=tool.data_source,
        )
    )
    n += 1
    lines.append(
        BomLine(
            item=n,
            parent="RB-ASSY-001",
            part_number="CON-LOCTITE-243",
            revision="A",
            description="Threadlocker (consumable)",
            make_buy=MakeBuy.BUY,
            qty=1,
            unit="bottle",
            cad_match=CadMatch.NOT_APPLICABLE,
            notes="CAD not applicable; excluded from CAD coverage denominator",
        )
    )
    return lines


def cad_coverage(lines: list[BomLine]) -> dict:
    unique = [x for x in lines if x.parent and x.cad_match != CadMatch.NOT_APPLICABLE]
    need = [x for x in unique if x.make_buy == MakeBuy.BUY]
    missing = [x for x in need if x.cad_match in {CadMatch.MISSING, CadMatch.ENVELOPE}]
    verified = [x for x in need if x.cad_match in {CadMatch.VERIFIED_MATCH, CadMatch.STANDARD_DIMS_VERIFIED}]
    return {
        "unique_geometry_rows": len(unique),
        "purchased_needing_geometry": len(need),
        "verified_or_standard": len(verified),
        "envelope_or_missing": [x.part_number for x in missing],
        "note": "quantity-weighted coverage is not used; many screws cannot hide a missing motor CAD",
    }
