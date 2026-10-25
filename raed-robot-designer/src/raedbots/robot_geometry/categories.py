from __future__ import annotations

from typing import Any


CATEGORIES: tuple[dict[str, Any], ...] = (
    {
        "id": "articulated_6r_industrial",
        "name": "Industrial articulated 6R",
        "name_ar": "روبوت صناعي مفصلي 6 محاور",
        "morphology": "serial_articulated",
        "axes": 6,
        "generator": "full_robot_6r",
        "supported": True,
        "templates": ["compact", "medium", "long"],
        "applications": ["handling", "machine_tending", "welding", "pick_and_place"],
        "description": "Six revolute joints with spherical wrist; full parametric geometry generator is available.",
    },
    {
        "id": "articulated_6r_cobot",
        "name": "Collaborative articulated 6R",
        "name_ar": "كوبوت مفصلي 6 محاور",
        "morphology": "serial_articulated",
        "axes": 6,
        "generator": "full_robot_6r",
        "supported": True,
        "templates": ["compact", "medium"],
        "applications": ["handling", "assembly", "pick_and_place"],
        "description": "Six-axis collaborative morphology; requires separate safety and force-limit validation.",
    },
    {
        "id": "scara_4r",
        "name": "SCARA 4R",
        "name_ar": "روبوت SCARA رباعي المحاور",
        "morphology": "scara",
        "axes": 4,
        "generator": "scara_4r_pending",
        "supported": False,
        "templates": [],
        "applications": ["assembly", "pick_and_place"],
        "description": "Catalog category reserved for a future dedicated SCARA kinematic and CAD generator.",
    },
    {
        "id": "delta_3r",
        "name": "Delta 3R",
        "name_ar": "روبوت دلتا ثلاثي المحاور",
        "morphology": "parallel_delta",
        "axes": 3,
        "generator": "delta_3r_pending",
        "supported": False,
        "templates": [],
        "applications": ["pick_and_place", "packaging"],
        "description": "Catalog category reserved for a future parallel-kinematics generator.",
    },
    {
        "id": "cartesian_3r",
        "name": "Cartesian 3R",
        "name_ar": "روبوت ديكارتي ثلاثي المحاور",
        "morphology": "cartesian",
        "axes": 3,
        "generator": "cartesian_3r_pending",
        "supported": False,
        "templates": [],
        "applications": ["machine_tending", "handling"],
        "description": "Catalog category reserved for a future Cartesian rail/gantry generator.",
    },
)


def list_categories() -> list[dict[str, Any]]:
    return [dict(item) for item in CATEGORIES]


def get_category(category_id: str) -> dict[str, Any]:
    for item in CATEGORIES:
        if item["id"] == category_id:
            return dict(item)
    raise ValueError(f"Unknown robot category: {category_id}")


def validate_category(category_id: str, family_id: str) -> dict[str, Any]:
    category = get_category(category_id)
    if not category["supported"]:
        raise ValueError(f"Robot category is cataloged but not yet supported: {category_id}")
    if family_id not in category["templates"]:
        raise ValueError(f"Template {family_id} is not available for category {category_id}")
    return category
