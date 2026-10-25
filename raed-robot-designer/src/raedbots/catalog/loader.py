from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from raedbots.domain.models import ComponentRecord, EndEffector, LinkFamily, Material

DATA = Path(__file__).with_name("data") / "catalog.json"


@lru_cache(maxsize=1)
def raw() -> dict:
    return json.loads(DATA.read_text(encoding="utf-8"))


def materials() -> dict[str, Material]:
    return {m["id"]: Material.model_validate(m) for m in raw()["materials"]}


def families() -> dict[str, LinkFamily]:
    return {f["id"]: LinkFamily.model_validate(f) for f in raw()["link_families"]}


def motors() -> dict[str, ComponentRecord]:
    return {m["id"]: ComponentRecord.model_validate(m) for m in raw()["motors"]}


def gearboxes() -> dict[str, ComponentRecord]:
    return {g["id"]: ComponentRecord.model_validate(g) for g in raw()["gearboxes"]}


def bearings() -> dict[str, ComponentRecord]:
    return {b["id"]: ComponentRecord.model_validate(b) for b in raw()["bearings"]}


def fasteners() -> dict[str, ComponentRecord]:
    return {f["id"]: ComponentRecord.model_validate(f) for f in raw()["fasteners"]}


def tools() -> dict[str, EndEffector]:
    return {t["id"]: EndEffector.model_validate(t) for t in raw()["tools"]}


def summary() -> dict:
    r = raw()
    return {
        "version": r["version"],
        "notes": r["notes"],
        "motors": [m["id"] for m in r["motors"]],
        "gearboxes": [g["id"] for g in r["gearboxes"]],
        "families": [f["id"] for f in r["link_families"]],
        "materials": [m["id"] for m in r["materials"]],
        "tools": [t["id"] for t in r["tools"]],
        "flange": r["flange"],
    }
