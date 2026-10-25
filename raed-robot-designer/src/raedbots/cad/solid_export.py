"""Review geometry only: hollow links, plates and housing envelopes, in millimetres."""
from pathlib import Path
import math
import numpy as np
from raedbots.catalog import loader
from raedbots.engineering.kinematics import fk_frames, NOMINAL_JOINTS
from raedbots.engineering.math3d import T_from_pose

def export_solids(cfg, out_dir: Path, workcell=None):
    try:
        import cadquery as cq
    except ImportError:
        return export_occt(cfg,out_dir,workcell)
    from scipy.spatial.transform import Rotation
    family = loader.families()[cfg.family_id]
    rows = cfg.dh_override or family.dh
    q = NOMINAL_JOINTS.copy()
    base = T_from_pose(workcell.base_pose) if workcell else np.eye(4)
    frames = fk_frames(rows, q, base)
    manufactured = out_dir / "Manufactured_Parts"
    assembly_dir = out_dir / "Assembly"
    manufactured.mkdir(parents=True, exist_ok=True)
    assembly_dir.mkdir(parents=True, exist_ok=True)
    assembly = cq.Assembly(name="RAED_REVIEW_ENVELOPES")
    files = []

    def location(transform):
        rv = Rotation.from_matrix(transform[:3, :3]).as_rotvec()
        angle = np.linalg.norm(rv)
        axis = rv / angle if angle > 1e-10 else np.array([0,0,1])
        return cq.Location(cq.Vector(*(transform[:3,3]*1000)), cq.Vector(*axis), math.degrees(angle))

    def add(pn, obj, loc):
        shape = obj.val()
        if not shape.isValid() or shape.Volume() <= 0:
            raise ValueError(f"Invalid solid: {pn}")
        for ext in ("step", "stl"):
            path = manufactured / f"{pn}_A.{ext}"
            cq.exporters.export(shape, str(path))
            files.append(str(path.relative_to(out_dir)))
        assembly.add(shape, name=pn, loc=loc)

    bs = family.base_size_m * 1000
    add("RB-BASE-001", cq.Workplane("XY").box(bs,bs,20,centered=(True,True,False)), location(base))
    for i in range(6):
        a,b = frames[i][:3,3],frames[i+1][:3,3]
        delta = b-a
        length = max(float(np.linalg.norm(delta)), .08)*1000
        w,h,t = family.width_m*1000, family.height_m*1000, family.wall_m*1000
        plane = cq.Workplane("XY")
        if family.section == "tube":
            obj = plane.circle(w/2).circle(w/2-t).extrude(length)
        else:
            obj = plane.rect(w,h).rect(w-2*t,h-2*t).extrude(length)
        z = delta / np.linalg.norm(delta) if np.linalg.norm(delta)>1e-10 else frames[i][:3,2]
        x = np.cross([0,1,0], z)
        if np.linalg.norm(x)<1e-8:
            x=np.cross([1,0,0],z)
        x=x/np.linalg.norm(x)
        transform = np.eye(4)
        transform[:3,:3] = np.column_stack([x,np.cross(z,x),z])
        transform[:3,3] = a
        add(f"RB-LNK-{i+1:02d}",obj,location(transform))
        add(f"RB-HSG-{i+1:02d}", cq.Workplane("XY").cylinder(60,w*.7), location(frames[i+1]))
    add("RB-FLG-001", cq.Workplane("XY").circle(40).extrude(16), location(frames[-1]))
    assembly.save(str(assembly_dir / "RB-ASSY-001_A.step"))
    cq.exporters.export(assembly.toCompound(), str(assembly_dir / "RB-ASSY-001_A.stl"))
    (out_dir / "README.txt").write_text(
        "REVIEW ONLY. STEP and STL units: millimetres. Pose: q=[0,30,50,0,40,0] degrees.\n"
        "Hollow link concepts and housing envelopes. No verified holes, fits, fasteners or purchased CAD.\n"
        "Not manufacturing drawings; mass solver and envelope CAD are separate approximations.\n",encoding="utf-8")
    return dict(files=files, kind="review_envelopes", units="mm", purchased_cad="not_included",backend="CadQuery")

def export_occt(cfg,out_dir,workcell=None):
    from raedbots.cad import occt_backend as oc
    family=loader.families()[cfg.family_id]
    rows=cfg.dh_override or family.dh
    base=T_from_pose(workcell.base_pose) if workcell else np.eye(4)
    frames=fk_frames(rows,NOMINAL_JOINTS,base)
    manufactured=out_dir/'Manufactured_Parts';assembly=out_dir/'Assembly'
    manufactured.mkdir(parents=True,exist_ok=True);assembly.mkdir(parents=True,exist_ok=True)
    shapes=[];files=[]
    def add(pn,shape,transform):
        for ext in ['step','stl']:
            path=manufactured/f'{pn}_A.{ext}';oc.export(shape,path);files.append(str(path.relative_to(out_dir)))
        tr=transform.copy();tr[:3,3]*=1000;shapes.append(oc.move(shape,tr))
    bs=family.base_size_m*1000
    add('RB-BASE-001',oc.box(bs,bs,20),base)
    for i in range(6):
        a,b=frames[i][:3,3],frames[i+1][:3,3];delta=b-a
        length=max(float(np.linalg.norm(delta)),.08)*1000
        w,h,t=family.width_m*1000,family.height_m*1000,family.wall_m*1000
        shape=(oc.cut(oc.cylinder(w/2,length),oc.cylinder(w/2-t,length)) if family.section=='tube'
               else oc.cut(oc.box(w,h,length),oc.box(w-2*t,h-2*t,length)))
        z=delta/np.linalg.norm(delta) if np.linalg.norm(delta)>1e-10 else frames[i][:3,2]
        x=np.cross([0,1,0],z)
        if np.linalg.norm(x)<1e-8:x=np.cross([1,0,0],z)
        x/=np.linalg.norm(x);tr=np.eye(4);tr[:3,:3]=np.column_stack([x,np.cross(z,x),z]);tr[:3,3]=a
        add(f'RB-LNK-{i+1:02d}',shape,tr)
        offset=np.eye(4);offset[2,3]=-30
        add(f'RB-HSG-{i+1:02d}',oc.move(oc.cylinder(w*.7,60),offset),frames[i+1])
    add('RB-FLG-001',oc.cylinder(40,16),frames[-1])
    for ext in ['step','stl']:oc.export(oc.compound(shapes),assembly/f'RB-ASSY-001_A.{ext}')
    (out_dir/'README.txt').write_text('REVIEW ONLY. Units: mm. Backend: native OpenCascade compatibility adapter.\n'
        'CadQuery could not import against the installed OCCT version.\n'
        'Hollow concept links and housing envelopes; no verified interfaces or purchased CAD.\n'
        'Not manufacturing geometry. CAD and mass solver are separate approximations.\n',encoding='utf-8')
    return dict(files=files,kind='review_envelopes',units='mm',purchased_cad='not_included',backend='OpenCascade compatibility adapter')
