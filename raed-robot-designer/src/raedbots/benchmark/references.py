"""Benchmark reference robots and the design-versus-reference comparison.

Each reference carries its source and an evidence status. Values that a source
does not state stay ``None`` rather than being estimated.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

WEB_MODELS = Path(__file__).resolve().parents[1] / "web" / "models"

RAED_R1 = {
    "id": "raed-r1",
    "name": "RAED R-1 (IND)",
    "manufacturer": "RaedBots / RAED Dynamics",
    "role": "target",
    "axes": 6,
    "payload_kg": 11.0,
    "reach_m": 1.30,
    "mass_kg": None,
    "max_tcp_speed_m_s": 3.0,
    "repeatability_mm": None,
    "applications": ["welding", "machine_tending", "material_handling", "packaging", "palletizing"],
    "source": "Public Egypt Innovate marketplace listing of the RAED R-1; product page "
              "raedbots.com/product/RAED_R-1_IND. Not taken from an official datasheet.",
    "evidence": "public_listing_unverified",
    "reach_definition": "not stated by source; compared against computed flange reach",
}


@lru_cache(maxsize=1)
def _up6() -> dict:
    data = json.loads((WEB_MODELS / "up6.json").read_text(encoding="utf-8"))
    return {
        "id": "yaskawa-up6",
        "name": data["name"],
        "manufacturer": "Yaskawa Motoman",
        "role": "competitor",
        "axes": 6,
        "payload_kg": data.get("payload_kg"),
        "reach_m": data.get("reach_m"),
        "mass_kg": data.get("mass_kg"),
        "max_tcp_speed_m_s": None,
        "repeatability_mm": None,
        "applications": ["handling", "machine_tending", "welding"],
        "source": f"RoboDK library header ({data['source_url']}); SHA-256 {data['source_sha256'][:16]}…",
        "evidence": "library_header_unverified",
        "reach_definition": "RoboDK header reach",
    }


def references() -> list[dict]:
    return [dict(RAED_R1), dict(_up6())]


def _status(value, target, higher_is_better=True):
    if value is None or target is None:
        return "unknown"
    ok = value >= target if higher_is_better else value <= target
    return "pass" if ok else "fail"


def compare(sizing: dict, requirements: dict, extra_references: list[dict] | None = None) -> dict:
    """Join the design's computed metrics with the reference robots."""
    reach = sizing["reach"]["flange_m"]
    capacity = sizing["static_payload_capacity_kg"]
    mass = sizing["robot_mass_kg"]
    design = {
        "id": sizing["revision_id"],
        "name": f"RAED design {sizing['revision_id']}",
        "role": "design",
        "axes": 6,
        "payload_kg": capacity,
        "reach_m": reach,
        "wrist_reach_m": sizing["reach"]["wrist_centre_m"],
        "mass_kg": mass,
        "payload_to_mass": (capacity / mass) if capacity is not None and mass else None,
        "required_payload_kg": requirements["payload_kg"]["value"],
        "required_reach_m": requirements["reach_m"]["value"],
        "evidence": "computed_static_screening",
        "source": "This revision: static gravity sizing + kinematic reach sweep",
    }
    refs = references() + list(extra_references or [])
    for ref in refs:
        if ref.get("payload_kg") and ref.get("mass_kg"):
            ref["payload_to_mass"] = ref["payload_kg"] / ref["mass_kg"]
        else:
            ref["payload_to_mass"] = None
        ref["delta"] = {
            "payload_kg": None if capacity is None or ref.get("payload_kg") is None else capacity - ref["payload_kg"],
            "reach_m": None if ref.get("reach_m") is None else reach - ref["reach_m"],
            "mass_kg": None if ref.get("mass_kg") is None else mass - ref["mass_kg"],
        }
    target = RAED_R1
    gaps = [
        {"metric": "Static payload capacity vs R-1 payload", "design": capacity, "target": target["payload_kg"],
         "unit": "kg", "status": _status(capacity, target["payload_kg"]),
         "note": "Static upper bound; dynamic capacity is lower."},
        {"metric": "Computed flange reach vs R-1 reach", "design": reach, "target": target["reach_m"],
         "unit": "m", "status": _status(reach, target["reach_m"]),
         "note": "R-1 reach definition is not stated by the source."},
        {"metric": "Static payload vs project requirement", "design": capacity,
         "target": design["required_payload_kg"], "unit": "kg",
         "status": _status(capacity, design["required_payload_kg"]), "note": ""},
        {"metric": "Computed flange reach vs project requirement", "design": reach,
         "target": design["required_reach_m"], "unit": "m",
         "status": _status(reach, design["required_reach_m"]), "note": ""},
    ]
    return {
        "design": design,
        "references": refs,
        "target_checks": gaps,
        "limiting_axis": sizing["limiting_axis"],
        "scope": "Reference values are public, unverified metadata. Design values are static screening "
                 "results; neither is a certified rating.",
    }
