from __future__ import annotations

import math

import numpy as np

from raedbots.domain.models import DhRow, EndEffector, Pose
from raedbots.engineering.math3d import T_from_pose, dh, pose_from_T, so3_error

NOMINAL_JOINTS = np.radians([0, 30, 50, 0, 40, 0])


def fk_frames(dh_rows: list[DhRow], q: np.ndarray, base: np.ndarray | None = None) -> list[np.ndarray]:
    T = np.eye(4) if base is None else base.copy()
    frames = [T.copy()]
    for row, qi in zip(dh_rows, q):
        T = T @ dh(row.a_m, row.alpha_rad, row.d_m, qi + row.theta_offset_rad)
        frames.append(T.copy())
    return frames


def fk_tcp(dh_rows: list[DhRow], q: np.ndarray, tool: EndEffector, base: np.ndarray | None = None) -> tuple[np.ndarray, list[np.ndarray]]:
    frames = fk_frames(dh_rows, q, base)
    tcp = frames[-1] @ T_from_pose(tool.tcp)
    return tcp, frames


def jacobian_numeric(dh_rows, q, tool, base, h=1e-6) -> np.ndarray:
    tcp0, _ = fk_tcp(dh_rows, q, tool, base)
    J = np.zeros((6, 6))
    for i in range(6):
        dq = q.copy()
        dq[i] += h
        tcp1, _ = fk_tcp(dh_rows, dq, tool, base)
        J[:3, i] = (tcp1[:3, 3] - tcp0[:3, 3]) / h
        J[3:, i] = so3_error(tcp0[:3, :3], tcp1[:3, :3]) / h
    return J


def min_svd(J: np.ndarray, lin_weight=1.0, ang_weight=0.2) -> float:
    W = np.diag([lin_weight] * 3 + [ang_weight] * 3)
    s = np.linalg.svd(W @ J, compute_uv=False)
    return float(s.min())


def ik_dls(
    dh_rows: list[DhRow],
    tool: EndEffector,
    target: Pose,
    seeds: list[np.ndarray],
    base: np.ndarray | None = None,
    require_ori: bool = True,
    pos_tol: float = 1e-4,
    ori_tol: float = 2e-2,
    iters: int = 80,
) -> tuple[np.ndarray | None, str]:
    Td = T_from_pose(target)
    best_err = 1e9
    best_reason = "no_seed"
    for seed in seeds:
        q = seed.copy()
        for _ in range(iters):
            for i, row in enumerate(dh_rows):
                q[i] = min(max(q[i], row.q_min_rad), row.q_max_rad)
            tcp, _ = fk_tcp(dh_rows, q, tool, base)
            e_p = Td[:3, 3] - tcp[:3, 3]
            e_r = so3_error(tcp[:3, :3], Td[:3, :3]) if require_ori else np.zeros(3)
            err = np.concatenate([e_p, e_r])
            n = float(np.linalg.norm(err))
            if n < best_err:
                best_err = n
            if np.linalg.norm(e_p) < pos_tol and (not require_ori or np.linalg.norm(e_r) < ori_tol):
                return q, "ok"
            J = jacobian_numeric(dh_rows, q, tool, base)
            if not require_ori:
                J = J[:3, :]
                err = e_p
            lam = 1e-3
            H = J.T @ J + lam * np.eye(6)
            try:
                dq = np.linalg.solve(H, J.T @ err)
            except np.linalg.LinAlgError:
                break
            q = q + dq
        best_reason = "ik_did_not_converge"
    return None, best_reason


def default_seeds(dh_rows: list[DhRow]) -> list[np.ndarray]:
    mid = np.array([(r.q_min_rad + r.q_max_rad) * 0.5 for r in dh_rows])
    zeros = np.zeros(6)
    stretched = np.array([0, math.radians(-20), math.radians(40), 0, math.radians(40), 0])
    folded = np.array([0.4, math.radians(40), math.radians(-50), 0.2, math.radians(-20), 0])
    return [NOMINAL_JOINTS.copy(), zeros, mid, stretched, folded, -stretched]


def in_limits(dh_rows: list[DhRow], q: np.ndarray, margin=1e-6) -> bool:
    return all(r.q_min_rad - margin <= qi <= r.q_max_rad + margin for r, qi in zip(dh_rows, q))
