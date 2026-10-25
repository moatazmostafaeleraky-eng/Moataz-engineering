from pathlib import Path
from xml.etree.ElementTree import Element, SubElement, tostring
from scipy.spatial.transform import Rotation
from raedbots.catalog import loader
from raedbots.domain.models import RobotConfiguration, EndEffector
from raedbots.engineering.math3d import T_from_pose

def write_urdf(cfg: RobotConfiguration, tool: EndEffector, path: Path):
    rows = cfg.dh_override or loader.families()[cfg.family_id].dh
    robot = Element("robot", name=f"raed_{cfg.family_id}_{cfg.revision_id}")
    SubElement(robot, "link", name="base_link")
    prev = "base_link"
    for i, (row, ax) in enumerate(zip(rows, cfg.axes)):
        # Standard DH: Rz(q + offset), then Tz(d) Tx(a) Rx(alpha).
        rotor, link = f"rotor{i+1}", f"link{i+1}"
        SubElement(robot, "link", name=rotor)
        SubElement(robot, "link", name=link)
        joint = SubElement(robot, "joint", name=f"J{i+1}", type="revolute")
        SubElement(joint, "parent", link=prev)
        SubElement(joint, "child", link=rotor)
        SubElement(joint, "origin", xyz="0 0 0", rpy=f"0 0 {row.theta_offset_rad}")
        SubElement(joint, "axis", xyz="0 0 1")
        motor, gear = loader.motors()[ax.motor_id], loader.gearboxes()[ax.gearbox_id]
        effort = min(float(gear.specs['rated_torque_nm']), float(motor.specs['rated_torque_nm']) * ax.ratio * float(gear.specs.get('efficiency', .75)))
        velocity = float(motor.specs.get('rated_speed_rpm', 3000)) * 2 * 3.141592653589793 / 60 / ax.ratio
        SubElement(joint, "limit", lower=str(row.q_min_rad), upper=str(row.q_max_rad), effort=str(effort), velocity=str(velocity))
        fixed = SubElement(robot, "joint", name=f"dh{i+1}", type="fixed")
        SubElement(fixed, "parent", link=rotor)
        SubElement(fixed, "child", link=link)
        SubElement(fixed, "origin", xyz=f"{row.a_m} 0 {row.d_m}", rpy=f"{row.alpha_rad} 0 0")
        prev = link
    SubElement(robot, "link", name="tool0")
    tcp = SubElement(robot, "joint", name="flange_to_tcp", type="fixed")
    SubElement(tcp, "parent", link=prev)
    SubElement(tcp, "child", link="tool0")
    angles = Rotation.from_matrix(T_from_pose(tool.tcp)[:3, :3]).as_euler("xyz")
    SubElement(tcp, "origin", xyz=f"{tool.tcp.x_m} {tool.tcp.y_m} {tool.tcp.z_m}", rpy=" ".join(map(str, angles)))
    path.write_bytes(tostring(robot, encoding="utf-8", xml_declaration=True))
