from __future__ import annotations

from pathlib import Path

from raedbots.catalog import loader
from raedbots.domain.models import RobotConfiguration


def part_boxes(cfg: RobotConfiguration) -> list[dict]:
    fam = loader.families()[cfg.family_id]
    dh = cfg.dh_override or fam.dh
    w = fam.width_m * cfg.scale_links
    parts = []
    bs = fam.base_size_m
    parts.append(
        {
            "part_number": "RB-BASE-001",
            "name": "Base plate",
            "make_buy": "make",
            "box": (-bs / 2, -bs / 2, 0, bs / 2, bs / 2, 0.02),
        }
    )
    z = 0.02
    for i, row in enumerate(dh):
        L = max(abs(row.a_m), abs(row.d_m), 0.08) * cfg.scale_links
        pn = f"RB-LNK-{i+1:02d}"
        parts.append(
            {
                "part_number": pn,
                "name": f"Link {i+1}",
                "make_buy": "make",
                "box": (-w / 2, -w / 2, z, w / 2, w / 2, z + L),
            }
        )
        z += L
        parts.append(
            {
                "part_number": f"RB-HSG-{i+1:02d}",
                "name": f"Joint housing {i+1}",
                "make_buy": "make",
                "box": (-w * 0.7, -w * 0.7, z, w * 0.7, w * 0.7, z + 0.06),
            }
        )
        z += 0.06
    parts.append(
        {
            "part_number": "RB-FLG-001",
            "name": "ISO 9409 tool flange",
            "make_buy": "make",
            "box": (-0.04, -0.04, z, 0.04, 0.04, z + 0.016),
        }
    )
    return parts


def export_cad(cfg: RobotConfiguration, out_dir: Path) -> dict:
    from raedbots.cad.solid_export import export_solids
    return export_solids(cfg, out_dir)
