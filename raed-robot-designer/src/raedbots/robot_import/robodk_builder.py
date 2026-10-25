from __future__ import annotations

import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Any

from raedbots.branding import COPYRIGHT_NOTICE, COPYRIGHT_TEXT

PART_ROLES = ("base", "joint1", "joint2", "joint3", "joint4", "joint5", "joint6")
PART_LABELS = {
    "base": "Base",
    "joint1": "Joint 1 / Link 1",
    "joint2": "Joint 2 / Link 2",
    "joint3": "Joint 3 / Link 3",
    "joint4": "Joint 4 / Link 4",
    "joint5": "Joint 5 / Link 5",
    "joint6": "Joint 6 / Link 6",
}


def safe_robot_slug(name: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_-]+", "-", name.strip()).strip("-_")
    return slug[:64] or "RAED-6AXIS-ROBOT"


def _build_config(config: dict[str, Any], part_files: dict[str, Path]) -> dict[str, Any]:
    return {
        "robot_name": config["robot_name"],
        "parameters": config["parameters"],
        "home_positions_deg": config["home_positions_deg"],
        "joint_senses": config["joint_senses"],
        "lower_limits_deg": config["lower_limits_deg"],
        "upper_limits_deg": config["upper_limits_deg"],
        "parts": {role: f"parts/{role}.step" for role in PART_ROLES},
        "source_filenames": {role: config.get("source_filenames", {}).get(role, part_files[role].name) for role in PART_ROLES},
        "assumption": "Every STEP component is positioned in the same assembled home pose; the home positions are used as joints_build and joints_home.",
    }


def _macro_source() -> str:
    return '''"""Build and save a six-axis RoboDK robot from this bundle's STEP link parts.

Run this file from RoboDK's Python macro runner after extracting the bundle.
The input parts and joint data are taken from config.json. Review the new
robot in RoboDK and verify link order, axes, limits, and motion before use.
"""
from pathlib import Path
import json
from robodk.robolink import Robolink, MAKE_ROBOT_6DOF

ROOT = Path(__file__).resolve().parent
CONFIG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
RDK = Robolink()
RDK.Render(False)
try:
    RDK.AddStation(CONFIG["robot_name"] + " - RAED STEP Build")
    objects = []
    for role in ("base", "joint1", "joint2", "joint3", "joint4", "joint5", "joint6"):
        item = RDK.AddFile(str(ROOT / CONFIG["parts"][role]))
        if not item.Valid():
            raise RuntimeError("RoboDK could not import the STEP part for " + role)
        label = "Base" if role == "base" else "Joint " + role[-1]
        item.setName(CONFIG["robot_name"] + " " + label)
        objects.append(item)
    pose = CONFIG["home_positions_deg"]
    robot = RDK.BuildMechanism(
        MAKE_ROBOT_6DOF,
        objects,
        CONFIG["parameters"],
        pose,
        CONFIG["home_positions_deg"],
        CONFIG["joint_senses"],
        CONFIG["lower_limits_deg"],
        CONFIG["upper_limits_deg"],
        name=CONFIG["robot_name"],
    )
    if not robot.Valid():
        raise RuntimeError("RoboDK did not create a valid six-axis robot item")
    output = ROOT / (CONFIG["output_filename"])
    robot.Save(str(output))
    if not output.is_file() or output.stat().st_size == 0:
        raise RuntimeError("RoboDK did not write the .robot file")
    print("RoboDK robot saved to: " + str(output))
finally:
    RDK.Render(True)
    RDK.Finish()
'''


def _try_live_robodk(parts_dir: Path, config: dict[str, Any], output: Path) -> tuple[bool, str]:
    """Use the optional RoboDK Python API; never emulate its proprietary .robot format."""
    rdk = None
    try:
        from robodk.robolink import Robolink, MAKE_ROBOT_6DOF

        rdk = Robolink()
        rdk.Render(False)
        rdk.AddStation(config["robot_name"] + " - RAED STEP Build")
        items = []
        for role in PART_ROLES:
            item = rdk.AddFile(str(parts_dir / f"{role}.step"))
            if not item.Valid():
                return False, "RoboDK did not accept all seven STEP link files."
            label = "Base" if role == "base" else "Joint " + role[-1]
            item.setName(config["robot_name"] + " " + label)
            items.append(item)
        home = config["home_positions_deg"]
        robot = rdk.BuildMechanism(
            MAKE_ROBOT_6DOF,
            items,
            config["parameters"],
            home,
            home,
            config["joint_senses"],
            config["lower_limits_deg"],
            config["upper_limits_deg"],
            name=config["robot_name"],
        )
        if not robot.Valid():
            return False, "RoboDK did not create a valid six-axis robot item."
        robot.Save(str(output))
        if not output.is_file() or output.stat().st_size == 0:
            return False, "RoboDK did not write a non-empty .robot file."
        return True, "RoboDK API created the .robot file."
    except (ImportError, ModuleNotFoundError):
        return False, "RoboDK Python API is not installed in the application environment."
    except Exception as exc:
        # Keep local paths and stack details out of the downloadable report.
        return False, f"RoboDK API could not complete the build ({type(exc).__name__})."
    finally:
        if rdk is not None:
            try:
                rdk.Render(True)
            except Exception:
                pass
            try:
                rdk.Finish()
            except Exception:
                pass


def create_robodk_bundle(
    part_files: dict[str, Path],
    config: dict[str, Any],
    output_zip: Path,
    work_dir: Path,
) -> str:
    """Create a RoboDK .robot with the RoboDK API, or a STEP+macro fallback kit."""
    output_zip = Path(output_zip)
    work_dir = Path(work_dir)
    root = work_dir / "RAED-ROBDK-6AXIS-BUILD"
    parts_dir = root / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    for role in PART_ROLES:
        shutil.copyfile(part_files[role], parts_dir / f"{role}.step")

    full_config = _build_config(config, part_files)
    full_config["output_filename"] = safe_robot_slug(config["robot_name"]) + ".robot"
    (root / "config.json").write_text(json.dumps(full_config, ensure_ascii=False, indent=2), encoding="utf-8")
    (root / "build_in_robodk.py").write_text(_macro_source(), encoding="utf-8")
    (root / "COPYRIGHT.txt").write_text(COPYRIGHT_TEXT, encoding="utf-8")

    robot_output = root / full_config["output_filename"]
    native, detail = _try_live_robodk(parts_dir, config, robot_output)
    mode = "native_robot" if native else "macro_required"
    (root / "build-status.json").write_text(json.dumps({"mode": mode, "detail": detail}, ensure_ascii=False, indent=2), encoding="utf-8")
    readme = [
        "RAED → ROBODK SIX-AXIS ROBOT BUILD",
        "",
        f"Robot: {config['robot_name']}",
        "Inputs: seven separate STEP objects (base plus one object for each moving link).",
        "Kinematics: RoboDK 6-axis mechanism parameters, six home positions, senses and joint limits supplied in config.json.",
        "Pose assumption: imported STEP parts are already arranged in the supplied home pose. The home pose is also used as the build pose.",
        "",
        "Important: a STEP model describes geometry; it does not reliably identify the six moving links, joint axes, joint limits or robot kinematics. Verify all parameters and jog each joint in RoboDK before relying on the model.",
        "This is not manufacturing, safety, collision, or accuracy approval.",
        "",
        f"Build mode: {mode}",
        detail,
    ]
    if native:
        readme.extend(["", f"The RoboDK API-generated robot file is {full_config['output_filename']}."])
    else:
        readme.extend([
            "",
            "To create the .robot file: extract this ZIP, open build_in_robodk.py as a Python macro in RoboDK, and run it. The macro creates a new station and saves the generated .robot beside itself.",
            "If RoboDK is installed but the app cannot connect to its API, install/enable RoboDK's Python API in the same Python environment as the app or run the bundled macro from RoboDK.",
        ])
    readme.extend(["", COPYRIGHT_NOTICE + ". All rights reserved."])
    (root / "README.txt").write_text("\n".join(readme) + "\n", encoding="utf-8")

    output_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(root))
    return mode
''
