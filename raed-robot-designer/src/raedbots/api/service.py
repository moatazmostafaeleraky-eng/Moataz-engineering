import hashlib
import json
import platform
import zipfile
from importlib.metadata import version
import numpy as np
from raedbots import ENGINE_VERSION
from raedbots.catalog import loader
from raedbots.configuration.engine import propose, inventory_ok
from raedbots.configuration.validation import validate
from raedbots.domain.models import ProjectRequirements, Workcell, RobotConfiguration, InventoryRow, SolverResult, CheckResult, CheckStatus
from raedbots.engineering.evaluate import evaluate
from raedbots.engineering.kinematics import fk_tcp, NOMINAL_JOINTS
from raedbots.engineering.math3d import T_from_pose, pose_from_T
from raedbots.storage import store
from raedbots.reports.bom import build_bom, cad_coverage
from raedbots.procurement.egypt import procurement_rows, html_report
from raedbots.branding import DESIGNER, COPYRIGHT_NOTICE, COPYRIGHT_TEXT

def digest(obj):
    return hashlib.sha256(json.dumps(obj,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()

def snapshot(req, cell, inventory, cfg):
    return dict(requirements=req.model_dump(mode='json'), workcell=cell.model_dump(mode='json'),
                inventory=[r.model_dump(mode='json') for r in inventory], configuration=cfg.model_dump(mode='json'),
                catalog_hash=digest(loader.raw()), engine_version=ENGINE_VERSION)

def save_revision(pid, req, cell, inventory, cfg=None, select=True):
    validate(req,cell)
    cfg = cfg or propose(req)
    snap=snapshot(req,cell,inventory,cfg)
    with store.LOCK:
        rec=store.load(pid)
        if cfg.revision_id in rec['configurations']:
            raise ValueError('Revision already exists')
        rec['configurations'][cfg.revision_id]=cfg.model_dump(mode='json')
        rec.setdefault('snapshots',{})[cfg.revision_id]=dict(data=snap,hash=digest(snap),created=store.now())
        if select:
            rec.update(selected_revision=cfg.revision_id,state='DRAFT',requirements=snap['requirements'],workcell=snap['workcell'],inventory=snap['inventory'])
        rec['history'].append(dict(event='revision_created',revision_id=cfg.revision_id,at=store.now()))
        store.save(rec)
    return cfg

def get_revision(pid,rid):
    rec=store.load(pid)
    if rid not in rec.get('snapshots',{}):
        raise FileNotFoundError('Revision does not exist')
    snap=rec['snapshots'][rid]
    if digest(snap['data'])!=snap['hash']:
        raise ValueError('Stored revision integrity check failed')
    return rec,snap

def solve_snapshot(snap):
    data=snap['data']
    if data['catalog_hash']!=digest(loader.raw()) or data['engine_version']!=ENGINE_VERSION:
        raise ValueError('Catalog or solver changed; create a new revision')
    cfg=RobotConfiguration.model_validate(data['configuration'])
    req=ProjectRequirements.model_validate(data['requirements'])
    cell=Workcell.model_validate(data['workcell'])
    sol=evaluate(cfg,req,cell)
    if req.inventory_only:
        ok,reasons=inventory_ok(cfg,[InventoryRow.model_validate(r) for r in data['inventory']])
        for c in sol.checks:
            if c.name=='inventory_constraint':
                c.status=CheckStatus.PASS if ok else CheckStatus.FAIL
                c.reasons=reasons
                c.evidence='revision inventory snapshot; motor quantities only'
        sol.checks.append(CheckResult(name='inventory_other_components',status=CheckStatus.UNKNOWN,method='gearboxes, tools and other purchased items not matched',assumptions='',evidence='inventory coverage incomplete'))
    sol.feasible=all(c.status in {CheckStatus.PASS,CheckStatus.NOT_APPLICABLE} for c in sol.checks)
    sol.rejected_reasons=[f'{c.name}: {c.status.value}' for c in sol.checks if c.status in {CheckStatus.FAIL,CheckStatus.UNKNOWN}]
    bom=build_bom(cfg,sol)
    coverage=cad_coverage(bom)
    sol.cad_coverage_unique=coverage['verified_or_standard']/max(coverage['purchased_needing_geometry'],1)
    return sol

def calculate(pid,rid,progress):
    _,snap=get_revision(pid,rid)
    progress(10,'Evaluating immutable revision')
    sol=solve_snapshot(snap)
    progress(90,'Saving results')
    with store.LOCK:
        rec,_=get_revision(pid,rid)
        # Keep reviewed calculations stable; a repeat request returns the saved result.
        if rid not in rec['results']:
            rec['results'][rid]=sol.model_dump(mode='json')
        if rec['selected_revision']==rid and rec['state']=='DRAFT':
            rec['state']='CALCULATED'
        store.save(rec)
    return dict(revision_id=rid,solver=rec['results'][rid])

def scene(cfg,cell,q=None,samples=240):
    family=loader.families()[cfg.family_id]
    rows=cfg.dh_override or family.dh
    angles=np.array(q if q is not None else NOMINAL_JOINTS,float)
    if len(angles)!=6 or not np.isfinite(angles).all():
        raise ValueError('Six finite joint angles required')
    if any(a<r.q_min_rad or a>r.q_max_rad for a,r in zip(angles,rows)):
        raise ValueError('Joint angle outside limits')
    tool=loader.tools()[cfg.tool_id]
    base=T_from_pose(cell.base_pose)
    tcp,frames=fk_tcp(rows,angles,tool,base)
    rng=np.random.default_rng(42)
    points=[]
    for _ in range(samples):
        qs=np.array([rng.uniform(r.q_min_rad,r.q_max_rad) for r in rows])
        t,_=fk_tcp(rows,qs,tool,base)
        points.append(t[:3,3].tolist())
    return dict(joints=angles.tolist(),limits=[[r.q_min_rad,r.q_max_rad] for r in rows],
                frames=[t.tolist() for t in frames],tcp=pose_from_T(tcp).model_dump(mode='json'),
                rom_points=points,workcell=cell.model_dump(mode='json'),family=family.model_dump(mode='json'),
                scope='Kinematic samples only; not a verified collision-free workspace',seed=42)

def report(pid,rid):
    rec,snap=get_revision(pid,rid)
    if rid not in rec['results']:
        raise ValueError('Calculate this revision first')
    cfg=RobotConfiguration.model_validate(snap['data']['configuration'])
    sol=SolverResult.model_validate(rec['results'][rid])
    lines=build_bom(cfg,sol)
    return dict(bom=[r.model_dump(mode='json') for r in lines],coverage=cad_coverage(lines),
                procurement=procurement_rows(lines,snap['data']['requirements']['delivery_governorate']))

_SIZING_CACHE={}

def sizing(pid,rid):
    _,snap=get_revision(pid,rid)
    key=(pid,rid,snap['hash'])
    if key not in _SIZING_CACHE:
        from raedbots.engineering.sizing import axis_sizing
        data=snap['data']
        _SIZING_CACHE[key]=axis_sizing(RobotConfiguration.model_validate(data['configuration']),
            ProjectRequirements.model_validate(data['requirements']),Workcell.model_validate(data['workcell']))
    return _SIZING_CACHE[key]

def benchmark(pid,rid,extra_references=None):
    from raedbots.benchmark.references import compare
    _,snap=get_revision(pid,rid)
    return compare(sizing(pid,rid),snap['data']['requirements'],extra_references)

def engineering_pdf(pid,rid):
    from raedbots.reports.pdf_report import build_pdf
    rec,snap=get_revision(pid,rid)
    if rid not in rec['results']:
        raise ValueError('Calculate this revision first')
    return build_pdf(project=rec,revision_id=rid,snapshot=snap['data'],solver=rec['results'][rid],
        sizing=sizing(pid,rid),benchmark=benchmark(pid,rid),bom=report(pid,rid)['bom'])

def export_package(pid,rid,progress):
    from raedbots.cad.solid_export import export_solids
    from raedbots.cad.urdf import write_urdf
    import csv
    rec,snap=get_revision(pid,rid)
    approval=next((a for a in reversed(rec['approvals']) if a['revision_id']==rid and a['snapshot_hash']==snap['hash'] and a['purpose']=='review'),None)
    if not approval:
        raise ValueError('Record a review decision for this exact revision before exporting')
    progress(5,'Building review CAD')
    cfg=RobotConfiguration.model_validate(snap['data']['configuration'])
    cell=Workcell.model_validate(snap['data']['workcell'])
    import tempfile
    export_root=store.DATA / pid / 'exports'
    export_root.mkdir(parents=True,exist_ok=True)
    # Build in a separate directory; existing exports remain intact on failure/cancel.
    with tempfile.TemporaryDirectory(dir=export_root) as tmp:
        from pathlib import Path
        out=Path(tmp)
        cad_result=export_solids(cfg,out/'CAD',cell)
        progress(60,'Writing BOM and reports')
        write_urdf(cfg,loader.tools()[cfg.tool_id],out/'robot.urdf')
        rep=report(pid,rid)
        for name,obj in [('snapshot',snap),('solver',rec['results'][rid]),('review',approval),('reports',rep),('catalog',loader.raw())]:
            store.atomic_json(out/f'{name}.json',obj)
        with (out/'BOM.csv').open('w',newline='',encoding='utf-8-sig') as f:
            writer=csv.DictWriter(f,fieldnames=list(rep['bom'][0]))
            writer.writeheader()
            for row in rep['bom']:
                writer.writerow({k: ("'"+v if isinstance(v,str) and v.startswith(('=','+','-','@')) else v) for k,v in row.items()})
        (out/'procurement-egypt.html').write_text(html_report(rep['procurement']),encoding='utf-8')
        progress(75,'Writing engineering report PDF')
        (out/'engineering-report.pdf').write_bytes(engineering_pdf(pid,rid))
        store.atomic_json(out/'actuator-sizing.json',sizing(pid,rid))
        store.atomic_json(out/'benchmark.json',benchmark(pid,rid))
        (out/'README.txt').write_text('FOR ENGINEERING REVIEW ONLY. NOT APPROVED FOR MANUFACTURING.\n'
            'CAD contains approximate manufactured geometry only; purchased CAD and verified interfaces are missing.\n'
            'Dynamic peak and RMS torque are screened on the task path (rigid-body model); stiffness, physical accuracy and repeatability remain unverified.\n'
            'BOM costs and Egypt supplier availability are unknown; no live supplier search has been performed.\n'
            f'{COPYRIGHT_NOTICE}. All rights reserved.\n',encoding='utf-8')
        (out/'COPYRIGHT.txt').write_text(COPYRIGHT_TEXT,encoding='utf-8')
        manifest=dict(revision_id=rid,snapshot_hash=snap['hash'],purpose='review',generated=store.now(),
            designed_by=DESIGNER,copyright_notice=COPYRIGHT_NOTICE,
            engine_version=ENGINE_VERSION,cad_backend=cad_result['backend'],python=platform.python_version(),packages={p:version(p) for p in ['cadquery','cadquery-ocp','numpy','scipy','fastapi','pydantic']},
            files={str(p.relative_to(out)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in out.rglob('*') if p.is_file()})
        store.atomic_json(out/'manifest.json',manifest)
        progress(90,'Packaging verified revision')
        zip_tmp=out/'package.zip'
        with zipfile.ZipFile(zip_tmp,'w',zipfile.ZIP_DEFLATED) as z:
            for p in out.rglob('*'):
                if p.is_file() and p!=zip_tmp:
                    z.write(p,str(p.relative_to(out)))
        zip_tmp.replace(export_root/f'{rid}.zip')
    return dict(download_url=f'/api/projects/{pid}/revisions/{rid}/download',revision_id=rid,purpose='review')
