from __future__ import annotations

import math

import numpy as np

from raedbots.domain.models import Pose


def rot_x(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0, 0], [0, c, -s, 0], [0, s, c, 0], [0, 0, 0, 1]], float)


def rot_z(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0, 0], [s, c, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]], float)


def trans(x=0.0, y=0.0, z=0.0) -> np.ndarray:
    T = np.eye(4)
    T[:3, 3] = [x, y, z]
    return T


def dh(a: float, alpha: float, d: float, theta: float) -> np.ndarray:
    """Standard DH: RotZ(theta) TransZ(d) TransX(a) RotX(alpha)."""
    return rot_z(theta) @ trans(z=d) @ trans(x=a) @ rot_x(alpha)


def quat_to_R(qw, qx, qy, qz) -> np.ndarray:
    n = math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz)
    w, x, y, z = qw / n, qx / n, qy / n, qz / n
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ],
        float,
    )


def R_to_quat(R: np.ndarray) -> tuple[float, float, float, float]:
    t = np.trace(R)
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        w = 0.25 * s
        x = (R[2, 1] - R[1, 2]) / s
        y = (R[0, 2] - R[2, 0]) / s
        z = (R[1, 0] - R[0, 1]) / s
    else:
        i = int(np.argmax([R[0, 0], R[1, 1], R[2, 2]]))
        if i == 0:
            s = math.sqrt(1 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
            w, x, y, z = (R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s
        elif i == 1:
            s = math.sqrt(1 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
            w, x, y, z = (R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s
        else:
            s = math.sqrt(1 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
            w, x, y, z = (R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s
    return w, x, y, z


def pose_from_T(T: np.ndarray, frame="world") -> Pose:
    w, x, y, z = R_to_quat(T[:3, :3])
    p = T[:3, 3]
    return Pose(x_m=float(p[0]), y_m=float(p[1]), z_m=float(p[2]), qw=w, qx=x, qy=y, qz=z, frame=frame)


def T_from_pose(p: Pose) -> np.ndarray:
    T = np.eye(4)
    T[:3, :3] = quat_to_R(p.qw, p.qx, p.qy, p.qz)
    T[:3, 3] = [p.x_m, p.y_m, p.z_m]
    return T


def so3_error(R_cur: np.ndarray, R_des: np.ndarray) -> np.ndarray:
    # Rotation logarithm in the world frame; unlike sin(theta), this detects 180 degrees.
    from scipy.spatial.transform import Rotation
    return Rotation.from_matrix(R_des @ R_cur.T).as_rotvec()
