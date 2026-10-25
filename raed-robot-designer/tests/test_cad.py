import math
import numpy as np
import pytest
from xml.etree.ElementTree import parse
from scipy.spatial.transform import Rotation
from raedbots.catalog import loader
from raedbots.configuration.engine import default_requirements,propose
from raedbots.cad.solid_export import export_solids
from raedbots.cad.urdf import write_urdf
from raedbots.engineering.kinematics import fk_tcp

def test_step_reimports_as_valid_mm_geometry(tmp_path):
    from OCP.STEPControl import STEPControl_Reader
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.BRepGProp import BRepGProp
    from OCP.GProp import GProp_GProps
    from OCP.Bnd import Bnd_Box
    from OCP.BRepBndLib import BRepBndLib
    def read(path):
        reader=STEPControl_Reader();assert reader.ReadFile(str(path))==IFSelect_RetDone
        reader.TransferRoots();return reader.OneShape()
    def volume(shape):
        props=GProp_GProps();BRepGProp.VolumeProperties_s(shape,props);return props.Mass()
    cfg=propose(default_requirements())
    export_solids(cfg,tmp_path)
    assembly=read(tmp_path/'Assembly/RB-ASSY-001_A.step')
    explorer=TopExp_Explorer(assembly,TopAbs_SOLID);count=0
    while explorer.More():count+=1;explorer.Next()
    assert count==14
    assert BRepCheck_Analyzer(assembly).IsValid()
    base=read(tmp_path/'Manufactured_Parts/RB-BASE-001_A.step')
    bounds=Bnd_Box();BRepBndLib.Add_s(base,bounds)
    assert bounds.CornerMax().X()-bounds.CornerMin().X()==pytest.approx(340,abs=1e-5)
    assert volume(base)==pytest.approx(340*340*20,rel=1e-8)
    link=read(tmp_path/'Manufactured_Parts/RB-LNK-01_A.step')
    assert volume(link)==pytest.approx((110**2-90**2)*280,rel=1e-8)

def test_urdf_matches_standard_dh_for_nonzero_joint_angles(tmp_path):
    cfg=propose(default_requirements());tool=loader.tools()[cfg.tool_id]
    path=tmp_path/'robot.urdf';write_urdf(cfg,tool,path)
    q=np.array([.3,-.7,.6,.2,.4,-.9]);T=np.eye(4);i=0
    for j in parse(path).getroot().findall('joint'):
        origin=j.find('origin');xyz=np.fromstring(origin.attrib['xyz'],sep=' ');rpy=np.fromstring(origin.attrib['rpy'],sep=' ')
        A=np.eye(4);A[:3,:3]=Rotation.from_euler('xyz',rpy).as_matrix();A[:3,3]=xyz;T=T@A
        if j.attrib['type']=='revolute':
            A=np.eye(4);A[:3,:3]=Rotation.from_rotvec([0,0,q[i]]).as_matrix();T=T@A;i+=1
    expected,_=fk_tcp(loader.families()[cfg.family_id].dh,q,tool)
    assert T==pytest.approx(expected,abs=1e-9)
