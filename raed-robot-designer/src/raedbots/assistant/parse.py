from __future__ import annotations

import re

from raedbots.configuration.engine import default_requirements, q
from raedbots.domain.models import ProjectRequirements


def parse_requirements(text: str) -> dict:
    """Deterministic extractor — not an LLM. Unknowns stay null."""
    t = text.lower().translate(str.maketrans("٠١٢٣٤٥٦٧٨٩٫", "0123456789."))
    req = default_requirements()
    m = re.search(r"(?<![\d.])(\d+(?:\.\d+)?)\s*(?:m(?![a-z])|متر)(?![a-z])", t)
    if m:
        req.reach_m = q(float(m.group(1)), "m")
    m = re.search(r"(?:حمول|payload)[^\d]{0,12}(\d+(?:\.\d+)?)\s*(?:kg|كجم)", t)
    if m:
        req.payload_kg = q(float(m.group(1)), "kg")
        req.payload_includes_tool = None
    m = re.search(r"(?:صندوق|box)[^\d]{0,20}(\d+(?:\.\d+)?)\s*(?:kg|كجم)", t)
    if m:
        req.workpiece_mass_kg = q(float(m.group(1)), "kg")
    if "مخزن" in text or "inventory" in t or "in stock" in t:
        req.inventory_only = True
    if "لحام" in text or "weld" in t:
        req.application = "welding"
        req.tool_choice = "mb-evo-24"
    status = "requires_clarification"
    missing = []
    if req.payload_includes_tool is None:
        missing.append("payload_includes_tool")
    if req.inventory_only:
        missing.append("inventory_file")
    return {
        "requirements": req.model_dump(),
        "status": status,
        "missing": missing,
        "note": "Rule-based extraction; omitted fields use starting defaults, not confirmed requirements.",
        "assumptions": "Review every field. This is not an LLM and does not infer unknown engineering values.",
    }


def validate_requirements(req: ProjectRequirements) -> list[str]:
    errs = []
    for name in (
        "workpiece_mass_kg",
        "payload_kg",
        "reach_m",
        "cycle_time_s",
        "position_accuracy_mm",
        "repeatability_mm",
    ):
        qty = getattr(req, name)
        if qty.value < 0:
            errs.append(f"{name} negative")
    if req.reach_m.unit not in {"m", "mm"}:
        errs.append("reach unit")
    if req.reach_m.unit == "mm":
        errs.append("convert reach to meters before solve")
    return errs
