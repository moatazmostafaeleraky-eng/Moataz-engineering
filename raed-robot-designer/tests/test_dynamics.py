import numpy as np
import pytest

from raedbots.configuration.engine import default_requirements, propose
from raedbots.domain.models import Pose, TaskPose, Workcell
from raedbots.engineering import dynamics
from raedbots.engineering.evaluate import evaluate, model_gravity_torques, static_load_model


@pytest.fixture
def arm():
    req = default_requirements()
    cfg = propose(req)
    return cfg, req, Workcell()


def test_at_rest_dynamics_equal_the_static_gravity_model(arm):
    cfg, req, wc = arm
    model = dynamics._model(cfg, req, wc)
    q = np.radians([10, 30, 50, 20, 40, 15])
    tau = dynamics.joint_torques(model, q, np.zeros(6), np.zeros(6))
    gravity = model_gravity_torques(static_load_model(cfg, req, wc), q, model["workpiece_kg"])
    # Holding torque is the reaction to the gravity moment.
    assert np.allclose(tau, -np.array(gravity), atol=1e-9)


def _energy(model, q, qd):
    bodies, origins, axes = dynamics._kinematics(model, q)
    energy = 0.5 * float(np.sum(model["rotor_out"] * qd ** 2))
    for (m, p, _, inertia), (jv, jw) in zip(bodies, dynamics._jacobians(bodies, origins, axes)):
        v, w = jv @ qd, jw @ qd
        energy += 0.5 * m * v @ v + 0.5 * w @ inertia @ w + m * 9.81 * p[2]
    return energy


def test_actuator_power_matches_the_rate_of_change_of_energy(arm):
    cfg, req, wc = arm
    model = dynamics._model(cfg, req, wc)
    q0, q1 = np.radians([0, 20, 30, 0, 20, 0]), np.radians([90, 60, -20, 90, -60, 120])
    qs, qds, qdds, ts = dynamics._min_jerk(q0, q1, 0.8, 801)
    for k in (200, 400, 600):
        power = dynamics.joint_torques(model, qs[k], qds[k], qdds[k]) @ qds[k]
        rate = (_energy(model, qs[k + 1], qds[k + 1]) - _energy(model, qs[k - 1], qds[k - 1])) / (ts[k + 1] - ts[k - 1])
        assert power == pytest.approx(rate, rel=1e-3, abs=1e-3)


def test_evaluate_fills_dynamic_and_thermal_checks_from_the_task_path(arm):
    cfg, req, _ = arm
    wc = Workcell(task_poses=[
        TaskPose(id="A", pose=Pose(x_m=0.7, y_m=-0.3, z_m=0.6, qw=0, qx=0, qy=1, qz=0), require_orientation=False),
        TaskPose(id="B", pose=Pose(x_m=0.7, y_m=0.3, z_m=0.7, qw=0, qx=0, qy=1, qz=0), require_orientation=False),
    ])
    checks = {c.name: c for c in evaluate(cfg, req, wc).checks}
    for name in ("dynamic_torque", "thermal"):
        assert checks[name].status.value in {"pass", "fail"}
    assert set(checks["dynamic_torque"].value["axes"]) == {f"J{i}" for i in range(1, 7)}
    dyn = dynamics.trajectory_dynamics(cfg, req, wc)
    assert dyn["available"] and dyn["path"] == ["A", "B"]
    for axis in dyn["axes"]:
        assert axis["peak_torque_nm"] + 1e-9 >= axis["rms_torque_nm"]
        # The sizing page and the check follow the same IK configurations.
        assert axis["peak_torque_nm"] == pytest.approx(checks["dynamic_torque"].value["axes"][axis["axis"]]["peak_torque_nm"])
