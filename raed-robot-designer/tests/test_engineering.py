import math
import numpy as np
import pytest
from pydantic import ValidationError
from raedbots.domain.models import Pose, DhRow, InertiaTensor, Obstacle
from raedbots.engineering.math3d import so3_error, rot_z, T_from_pose, pose_from_T
from raedbots.engineering.kinematics import fk_frames, fk_tcp, ik_dls, default_seeds
from raedbots.engineering.evaluate import evaluate, gravity_torques
from raedbots.configuration.engine import default_requirements, propose
from raedbots.catalog import loader
from raedbots.domain.models import Workcell

def test_rotation_half_turn_is_not_zero_error():
    error=so3_error(np.eye(3),rot_z(math.pi)[:3,:3])
    assert np.linalg.norm(error)==pytest.approx(math.pi)

def test_planar_fk_analytical():
    rows=[DhRow(a_m=1,alpha_rad=0,d_m=0,q_min_rad=-math.pi,q_max_rad=math.pi) for _ in range(6)]
    q=np.array([math.pi/2, -math.pi/2, 0,0,0,0])
    T=fk_frames(rows,q)[-1]
    assert T[:3,3]==pytest.approx([5,1,0],abs=1e-10)
    assert T[:3,:3]==pytest.approx(np.eye(3),abs=1e-10)

def test_gravity_known_horizontal_lever_and_rotated_base():
    rows=[DhRow(a_m=1 if i==0 else 0,alpha_rad=0,d_m=0,q_min_rad=-3,q_max_rad=3) for i in range(6)]
    # Rotate joint Z to world Y: a horizontal metre arm and 2 kg give 19.62 Nm.
    base=np.array([[1.,0,0,0],[0,0,1,0],[0,-1,0,0],[0,0,0,1]])
    tau=gravity_torques(rows,np.zeros(6),[0]*6,base=base,attached_loads=[(2,[1,0,0])])
    assert tau[0]==pytest.approx(19.62)
    assert tau[1:]==pytest.approx([0]*5)

def test_fk_ik_roundtrip_nonidentity_base():
    rows=loader.families()['medium'].dh;tool=loader.tools()['rg2']
    base=T_from_pose(Pose(x_m=.4,y_m=-.2,z_m=.1,qw=.8,qz=.6))
    q=np.array([.2,-.5,.8,.1,.5,-.2])
    target,_=fk_tcp(rows,q,tool,base)
    result,reason=ik_dls(rows,tool,pose_from_T(target),default_seeds(rows),base)
    assert result is not None,reason
    actual,_=fk_tcp(rows,result,tool,base)
    assert actual[:3,3]==pytest.approx(target[:3,3],abs=1e-4)
    assert np.linalg.norm(so3_error(actual[:3,:3],target[:3,:3]))<.02

def test_missing_evidence_is_not_feasible():
    req=default_requirements();sol=evaluate(propose(req),req,Workcell())
    assert not sol.feasible
    assert sol.cycle_time_s is None
    assert any(c.name=='payload_definition' and c.status=='unknown' for c in sol.checks)
    assert any('dynamic_torque' in reason for reason in sol.rejected_reasons)

@pytest.mark.parametrize('data',[dict(ixx=1,iyy=1,izz=3),dict(ixx=1,iyy=1,izz=1,ixy=2)])
def test_nonphysical_inertia_rejected(data):
    with pytest.raises(ValidationError):InertiaTensor(**data)

def test_pose_and_obstacle_reject_invalid_data():
    with pytest.raises(ValidationError):Pose(x_m=float('nan'),y_m=0,z_m=0)
    with pytest.raises(ValidationError):Obstacle(id='x',pose=Pose(x_m=0,y_m=0,z_m=0),size_m=[1,-1,1])
