from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import asyncio
import multiprocessing
from typing import Literal
import uuid
import math
from fastapi import FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, ConfigDict, Field, model_validator
from raedbots import ENGINE_VERSION
from raedbots.api import jobs, service
from raedbots.assistant.parse import parse_requirements
from raedbots.catalog import loader
from raedbots.configuration.engine import default_requirements, propose
from raedbots.configuration.validation import validate
from raedbots.domain.models import ProjectRequirements, Workcell, InventoryRow, RobotConfiguration
from raedbots.optimization.search import generate_candidates, pareto
from raedbots.robot_geometry.full_design import GeometryDesign, GeometryOptimizationRequest, optimize_geometry
from raedbots.robot_geometry.categories import list_categories
from raedbots.cad.full_robot_export import export_full_robot
from raedbots.robot_import.robodk_robot import make_import_zip, parse_legacy_qcompress_robot
from raedbots.robot_import.robodk_builder import PART_ROLES, create_robodk_bundle
from raedbots.branding import COPYRIGHT_TEXT
from raedbots.benchmark.references import references as benchmark_references
from raedbots.storage import store

app=FastAPI(title='RAED Robot Designer',version='0.3.0')

_CAD_POOL=None

def _cad_pool():
    """One worker process for mesh-to-solid reconstruction.

    OpenCascade and VTK keep the GIL for minutes on large RoboDK meshes; running them in
    a thread froze every other request, so the long conversion runs in its own process.
    """
    global _CAD_POOL
    if _CAD_POOL is None:
        _CAD_POOL=ProcessPoolExecutor(max_workers=1,mp_context=multiprocessing.get_context('spawn'))
    return _CAD_POOL
app.add_middleware(TrustedHostMiddleware,allowed_hosts=['127.0.0.1','localhost','testserver','[::1]','*.manus.computer'])
WEB=Path(__file__).resolve().parents[1]/'web'

@app.middleware('http')
async def local_origin(request: Request,call_next):
    origin=request.headers.get('origin')
    preview_origin = bool(origin and origin.startswith('https://') and origin.endswith('.manus.computer'))
    if request.method not in {'GET','HEAD','OPTIONS'} and origin and origin!=f'{request.url.scheme}://{request.headers.get("host")}' and not preview_origin:
        return JSONResponse({'detail':'Cross-origin writes are disabled for the local application'},status_code=403)
    response=await call_next(request)
    response.headers['X-Content-Type-Options']='nosniff'
    response.headers['X-Frame-Options']='DENY'
    return response

@app.exception_handler(FileNotFoundError)
async def missing(request,exc):
    return JSONResponse({'detail':'Project, revision, job or export not found'},status_code=404)

@app.exception_handler(ValueError)
async def invalid(request,exc):
    return JSONResponse({'detail':str(exc)},status_code=422)

class Body(BaseModel):
    model_config=ConfigDict(extra='forbid',allow_inf_nan=False)

class NewProject(Body):
    name: str=Field(default='New robot project',min_length=1,max_length=100)

class Inputs(Body):
    requirements: ProjectRequirements
    workcell: Workcell=Field(default_factory=Workcell)
    inventory: list[InventoryRow]=Field(default_factory=list,max_length=2000)

class Optimize(Body):
    project_id: str
    revision_id: str
    limit: int=Field(default=6,ge=1,le=18)

class Review(Body):
    purpose: Literal['review','prototype','manufacturing']='review'
    reviewer: str=Field(min_length=1,max_length=100)
    notes: str=Field(default='',max_length=4000)

class Parse(Body):
    text: str=Field(min_length=1,max_length=4000)

class Angles(Body):
    joints: list[float]=Field(min_length=6,max_length=6)

class ExtraReference(Body):
    name: str=Field(min_length=1,max_length=120)
    payload_kg: float|None=Field(default=None,ge=0,le=5000)
    reach_m: float|None=Field(default=None,gt=0,le=20)
    mass_kg: float|None=Field(default=None,gt=0,le=50000)
    source: str=Field(default='Imported RoboDK header',max_length=300)

class BenchmarkRequest(Body):
    extra_references: list[ExtraReference]=Field(default_factory=list,max_length=6)

class FullDesignExport(Body):
    design: GeometryDesign
    tool_id: str

class RoboDKBuild(Body):
    robot_name: str=Field(min_length=1,max_length=100)
    parameters: list[float]=Field(min_length=13,max_length=13)
    home_positions_deg: list[float]=Field(min_length=6,max_length=6)
    joint_senses: list[int]=Field(min_length=6,max_length=6)
    lower_limits_deg: list[float]=Field(min_length=6,max_length=6)
    upper_limits_deg: list[float]=Field(min_length=6,max_length=6)

    @model_validator(mode='after')
    def check_robot_definition(self):
        self.robot_name=self.robot_name.strip()
        if not self.robot_name:
            raise ValueError('Enter a robot name')
        if any(sense not in (-1,1) for sense in self.joint_senses):
            raise ValueError('Each joint sense must be -1 or 1')
        for i,(home,low,high) in enumerate(zip(self.home_positions_deg,self.lower_limits_deg,self.upper_limits_deg),start=1):
            if low>=high:
                raise ValueError(f'Joint {i} minimum limit must be lower than its maximum limit')
            if not low<=home<=high:
                raise ValueError(f'Joint {i} home position must fall within its joint limits')
        return self

@app.get('/api/health')
def health():
    return dict(status='ok',engine_version=ENGINE_VERSION)

@app.get('/api/catalog')
def catalog():
    return loader.raw()

@app.get('/api/defaults')
def defaults():
    req=default_requirements()
    return dict(requirements=req.model_dump(mode='json'),workcell=Workcell().model_dump(mode='json'))

@app.post('/api/assistant/parse-request')
def parse(body: Parse):
    return parse_requirements(body.text)

@app.get('/api/projects')
def projects():
    return store.list_projects()

@app.post('/api/projects',status_code=201)
def create(body: NewProject):
    return store.create_project(body.name.strip() or 'New robot project')

@app.get('/api/projects/{pid}')
def project(pid: str):
    return store.load(pid)

@app.post('/api/projects/{pid}/configurations',status_code=201)
def configuration(pid: str,body: Inputs):
    cfg=service.save_revision(pid,body.requirements,body.workcell,body.inventory)
    return dict(configuration=cfg.model_dump(mode='json'),revision_id=cfg.revision_id)

@app.post('/api/preview')
def preview(body: Inputs):
    validate(body.requirements,body.workcell)
    return service.scene(propose(body.requirements),body.workcell)

@app.get('/api/projects/{pid}/revisions/{rid}/scene')
def get_scene(pid: str,rid: str):
    _,snap=service.get_revision(pid,rid)
    return service.scene(RobotConfiguration.model_validate(snap['data']['configuration']),Workcell.model_validate(snap['data']['workcell']))

@app.post('/api/projects/{pid}/revisions/{rid}/scene')
def pose_scene(pid: str,rid: str,body: Angles):
    _,snap=service.get_revision(pid,rid)
    return service.scene(RobotConfiguration.model_validate(snap['data']['configuration']),Workcell.model_validate(snap['data']['workcell']),body.joints,samples=0)

@app.post('/api/projects/{pid}/revisions/{rid}/calculations',status_code=202)
def calculation(pid: str,rid: str):
    service.get_revision(pid,rid)
    return jobs.submit('calculate',pid,rid,lambda progress:service.calculate(pid,rid,progress))

@app.get('/api/jobs/{jid}')
def get_job(jid: str):
    return jobs.get(jid)

@app.post('/api/jobs/{jid}/cancel')
def cancel_job(jid: str):
    return jobs.cancel(jid)

@app.post('/api/optimization/jobs',status_code=202)
def optimize(body: Optimize):
    _,snap=service.get_revision(body.project_id,body.revision_id)
    def run(progress):
        data=snap['data']
        req=ProjectRequirements.model_validate(data['requirements'])
        cell=Workcell.model_validate(data['workcell'])
        inventory=[InventoryRow.model_validate(r) for r in data['inventory']]
        candidates=generate_candidates(req,body.limit)
        rows=[]
        snapshots={}
        for i,cfg in enumerate(candidates):
            progress(5+int(85*i/max(len(candidates),1)),f'Candidate {i+1}/{len(candidates)}')
            cfg.parent_revision=body.revision_id
            ds=service.snapshot(req,cell,inventory,cfg)
            candidate_snap=dict(data=ds,hash=service.digest(ds),created=store.now())
            sol=service.solve_snapshot(candidate_snap)
            snapshots[cfg.revision_id]=candidate_snap
            rows.append(dict(revision_id=cfg.revision_id,family_id=cfg.family_id,material_id=cfg.material_id,
                feasible=sol.feasible,mass_kg=sol.robot_mass_kg,cycle_s=sol.cycle_time_s,
                rejected=sol.rejected_reasons,solver=sol.model_dump(mode='json'),configuration=cfg.model_dump(mode='json')))
        front=pareto(rows)
        for row in rows:
            row['on_pareto']=row['revision_id'] in front
        progress(95,'Saving candidate revisions')
        with store.LOCK:
            rec=store.load(body.project_id)
            rec['snapshots'].update(snapshots)
            for row in rows:
                rid=row['revision_id']
                rec['configurations'][rid]=row['configuration']
                rec['results'][rid]=row['solver']
            rec['history'].append(dict(event='optimization',source=body.revision_id,candidates=[r['revision_id'] for r in rows],at=store.now()))
            store.save(rec)
        return dict(candidates=rows,pareto_ids=front,scope='Bounded catalog comparison; unknown checks exclude candidates from the feasible Pareto frontier')
    return jobs.submit('optimize',body.project_id,body.revision_id,run)

@app.post('/api/projects/{pid}/revisions/{rid}/select')
def select(pid: str,rid: str):
    with store.LOCK:
        rec,snap=service.get_revision(pid,rid)
        state='CALCULATED' if rid in rec['results'] else 'DRAFT'
        if any(a['revision_id']==rid for a in rec['approvals']):
            state='ENGINEERING_REVIEW'
        rec.update(selected_revision=rid,state=state,requirements=snap['data']['requirements'],workcell=snap['data']['workcell'],inventory=snap['data']['inventory'])
        store.save(rec)
    return rec

@app.get('/api/projects/{pid}/revisions/{rid}/reports')
def reports(pid: str,rid: str):
    return service.report(pid,rid)

def _calculated(pid: str,rid: str):
    rec,_=service.get_revision(pid,rid)
    if rid not in rec['results']:
        raise HTTPException(409,'Calculate the revision first')

@app.get('/api/projects/{pid}/revisions/{rid}/actuator-sizing')
def actuator_sizing(pid: str,rid: str):
    _calculated(pid,rid)
    return service.sizing(pid,rid)

@app.get('/api/benchmark/references')
def get_benchmark_references():
    return {'references':benchmark_references()}

@app.post('/api/projects/{pid}/revisions/{rid}/benchmark')
def revision_benchmark(pid: str,rid: str,body: BenchmarkRequest):
    _calculated(pid,rid)
    extra=[dict(id=f'import-{i+1}',manufacturer='Imported',role='competitor',axes=6,max_tcp_speed_m_s=None,
                repeatability_mm=None,applications=[],evidence='library_header_unverified',
                reach_definition='RoboDK header reach',**r.model_dump()) for i,r in enumerate(body.extra_references)]
    return service.benchmark(pid,rid,extra)

@app.get('/api/projects/{pid}/revisions/{rid}/report.pdf')
def revision_pdf(pid: str,rid: str):
    _calculated(pid,rid)
    return Response(service.engineering_pdf(pid,rid),media_type='application/pdf',
                    headers={'Content-Disposition':f'attachment; filename="RAED-{rid}-engineering-report.pdf"'})

@app.post('/api/projects/{pid}/revisions/{rid}/reviews')
def review(pid: str,rid: str,body: Review):
    if body.purpose!='review':
        raise HTTPException(409,'Prototype/manufacturing approval unavailable: dynamics, interfaces and physical validation are incomplete')
    with store.LOCK:
        rec,snap=service.get_revision(pid,rid)
        if rid not in rec['results']:
            raise HTTPException(409,'Calculate the revision before review')
        existing=next((a for a in rec['approvals'] if a['revision_id']==rid and a['snapshot_hash']==snap['hash'] and a['purpose']==body.purpose),None)
        if existing:
            return existing
        approval=dict(approval_id='apr-'+uuid.uuid4().hex[:10],revision_id=rid,purpose=body.purpose,
            state='ENGINEERING_REVIEW',timestamp=store.now(),snapshot_hash=snap['hash'],reviewer=body.reviewer,notes=body.notes)
        rec['approvals'].append(approval)
        if rec['selected_revision']==rid:
            rec['state']='ENGINEERING_REVIEW'
        store.save(rec)
    return approval

@app.post('/api/projects/{pid}/revisions/{rid}/exports',status_code=202)
def export(pid: str,rid: str):
    rec,snap=service.get_revision(pid,rid)
    if not any(a['revision_id']==rid and a['snapshot_hash']==snap['hash'] and a['purpose']=='review' for a in rec['approvals']):
        raise HTTPException(409,'Review this exact revision before exporting')
    return jobs.submit('export',pid,rid,lambda progress:service.export_package(pid,rid,progress))

@app.get('/api/projects/{pid}/revisions/{rid}/download')
def download(pid: str,rid: str):
    service.get_revision(pid,rid)
    path=store.DATA/pid/'exports'/f'{rid}.zip'
    if not path.is_file():
        raise FileNotFoundError()
    return FileResponse(path,filename=f'RAED-{rid}-REVIEW.zip',media_type='application/zip')

@app.post('/api/full-design/optimize')
def full_design_optimize(body: GeometryOptimizationRequest):
    """Search independent link dimensions for a target TCP pose.

    This is additive to the original bounded catalog optimizer. It returns
    explainable geometry candidates and does not silently approve manufacturing.
    """
    return optimize_geometry(body)

@app.get('/api/full-design/categories')
def full_design_categories():
    return {"categories": list_categories()}

@app.post('/api/full-design/export')
def full_design_export(body: FullDesignExport):
    """Generate separate part STEP files plus a full assembly package."""
    import shutil
    import tempfile
    import zipfile

    tmp_root = Path(tempfile.mkdtemp(prefix='raed-full-design-'))
    try:
        export_full_robot(body.design, body.tool_id, tmp_root / 'RAED-FULL-ROBOT')
        (tmp_root / 'RAED-FULL-ROBOT' / 'COPYRIGHT.txt').write_text(COPYRIGHT_TEXT, encoding='utf-8')
        package = tmp_root / 'RAED-FULL-ROBOT-STEP-PACKAGE.zip'
        with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in (tmp_root / 'RAED-FULL-ROBOT').rglob('*'):
                if path.is_file():
                    archive.write(path, path.relative_to(tmp_root / 'RAED-FULL-ROBOT'))
        return FileResponse(package, filename='RAED-FULL-ROBOT-STEP-PACKAGE.zip', media_type='application/zip', background=None)
    except Exception:
        shutil.rmtree(tmp_root, ignore_errors=True)
        raise

@app.post('/api/reference-import/robodk-robot')
async def import_robodk_robot(file: UploadFile = File(...), smooth: bool = Form(False), smooth_tolerance_mm: float = Form(0.25)):
    """Import an authorized RoboDK .robot reference asset.

    The converter only accepts the recognized legacy qCompress triangle-mesh
    container. It deliberately refuses unknown variants instead of guessing.
    """
    import shutil
    import tempfile

    filename = Path(file.filename or '').name
    if not filename.lower().endswith('.robot'):
        raise HTTPException(415, 'Upload a RoboDK .robot file')
    if not 0.05 <= smooth_tolerance_mm <= 1.0:
        raise HTTPException(422, 'Smooth-surface tolerance must be between 0.05 and 1.0 mm')
    tmp_root = Path(tempfile.mkdtemp(prefix='raed-robodk-upload-'))
    source = tmp_root / filename
    package = tmp_root / 'ROBDK-REFERENCE-IMPORT.zip'
    try:
        data = await file.read()
        if len(data) > 200 * 1024 * 1024:
            raise HTTPException(413, 'The .robot file is larger than the 200 MB local import limit')
        source.write_bytes(data)
        manifest = await asyncio.get_running_loop().run_in_executor(_cad_pool(), make_import_zip, source, package, smooth, smooth_tolerance_mm)
        skipped = [item['part'] for item in manifest.get('skipped_links', [])]
        return FileResponse(package, filename='ROBDK-REFERENCE-IMPORT.zip', media_type='application/zip', background=None,
                            headers={'X-RAED-PARTS': str(manifest.get('part_count', 0)), 'X-RAED-SKIPPED': ','.join(skipped),
                                     'X-RAED-SMOOTH': str(len(manifest.get('smooth_surface_parts', [])))})
    except HTTPException:
        shutil.rmtree(tmp_root, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(tmp_root, ignore_errors=True)
        raise

@app.post('/api/reference-import/robodk-robot/inspect')
async def inspect_robodk_robot(file: UploadFile = File(...)):
    """Return detailed benchmark metadata while omitting raw triangle arrays."""
    import shutil
    import tempfile

    filename = Path(file.filename or '').name
    if not filename.lower().endswith('.robot'):
        raise HTTPException(415, 'Upload a RoboDK .robot file')
    tmp_root = Path(tempfile.mkdtemp(prefix='raed-robodk-inspect-'))
    source = tmp_root / filename
    try:
        data = await file.read()
        if len(data) > 200 * 1024 * 1024:
            raise HTTPException(413, 'The .robot file is larger than the 200 MB local import limit')
        source.write_bytes(data)
        manifest = await run_in_threadpool(parse_legacy_qcompress_robot, source)
        return {
            key: value for key, value in manifest.items() if key != 'links'
        } | {
            'links': [
                {'name': link['name'], 'metrics': link['metrics']}
                for link in manifest['links']
            ]
        }
    except HTTPException:
        raise
    finally:
        shutil.rmtree(tmp_root, ignore_errors=True)

@app.post('/api/robodk/build')
async def build_robodk_from_step(
    robot_name: str=Form(...),
    parameters_json: str=Form(...),
    home_json: str=Form(...),
    lower_limits_json: str=Form(...),
    upper_limits_json: str=Form(...),
    joint_senses_json: str=Form(...),
    part_map_json: str=Form(...),
    step_files: list[UploadFile]=File(...),
):
    """Build a RoboDK robot from seven separately mapped STEP link objects."""
    import json
    import shutil
    import tempfile
    from starlette.background import BackgroundTask

    tmp_root=Path(tempfile.mkdtemp(prefix='raed-robodk-build-'))
    try:
        try:
            fields={
                'robot_name':robot_name,
                'parameters':json.loads(parameters_json),
                'home_positions_deg':json.loads(home_json),
                'lower_limits_deg':json.loads(lower_limits_json),
                'upper_limits_deg':json.loads(upper_limits_json),
                'joint_senses':json.loads(joint_senses_json),
            }
        except json.JSONDecodeError as exc:
            raise HTTPException(422,'RoboDK parameters and joint values must be valid JSON arrays') from exc
        for key in ('parameters','home_positions_deg','lower_limits_deg','upper_limits_deg','joint_senses'):
            if not isinstance(fields[key],list):
                raise HTTPException(422,f'{key} must be a JSON array')
        for key in ('parameters','home_positions_deg','lower_limits_deg','upper_limits_deg'):
            if any(type(value) not in (int,float) or not math.isfinite(float(value)) for value in fields[key]):
                raise HTTPException(422,f'{key} must contain finite numeric values')
        if any(type(value) is not int or value not in (-1,1) for value in fields['joint_senses']):
            raise HTTPException(422,'Each joint sense must be the integer -1 or 1')
        config=RoboDKBuild.model_validate(fields).model_dump(mode='json')
        if not 7<=len(step_files)<=20:
            raise HTTPException(422,'Upload between 7 and 20 STEP part files, then map seven unique objects to base and joints 1–6')
        try:
            mapping=json.loads(part_map_json)
        except json.JSONDecodeError as exc:
            raise HTTPException(422,'The base/link file mapping is not valid JSON') from exc
        if not isinstance(mapping,dict) or set(mapping)!=set(PART_ROLES):
            raise HTTPException(422,'Choose one mapped STEP object for the base and for each of the six joints')
        if any(type(mapping[role]) is not int for role in PART_ROLES):
            raise HTTPException(422,'STEP part mapping values must be file indexes')
        indexes=[mapping[role] for role in PART_ROLES]
        if len(set(indexes))!=7 or any(index<0 or index>=len(step_files) for index in indexes):
            raise HTTPException(422,'The base and six joint links must use seven different uploaded STEP files')

        input_dir=tmp_root/'input'
        input_dir.mkdir()
        part_paths={}
        source_filenames={}
        total_bytes=0
        for role in PART_ROLES:
            upload=step_files[mapping[role]]
            filename=(upload.filename or '').replace('\\','/').rsplit('/',1)[-1]
            if Path(filename).suffix.lower() not in {'.step','.stp'}:
                raise HTTPException(415,f'{role} must be a .step or .stp file')
            data=await upload.read(100*1024*1024+1)
            if len(data)>100*1024*1024:
                raise HTTPException(413,'Each STEP part must be no larger than 100 MB')
            total_bytes+=len(data)
            if total_bytes>300*1024*1024:
                raise HTTPException(413,'The seven selected STEP parts exceed the 300 MB upload limit')
            header=data[:256].lstrip()
            if header.startswith(bytes.fromhex('efbbbf')):
                header=header[3:].lstrip()
            if not header.startswith(b'ISO-10303-21;'):
                raise HTTPException(415,f'{filename} does not have a recognizable STEP Part 21 header')
            destination=input_dir/f'{role}.step'
            destination.write_bytes(data)
            part_paths[role]=destination
            source_filenames[role]=filename

        package=tmp_root/'RAED-ROBDK-6AXIS-BUILD-PACKAGE.zip'
        config['source_filenames']=source_filenames
        mode=await run_in_threadpool(create_robodk_bundle,part_paths,config,package,tmp_root)
        return FileResponse(
            package,
            filename=package.name,
            media_type='application/zip',
            headers={'X-RAED-ROBDK-MODE':mode},
            background=BackgroundTask(shutil.rmtree,tmp_root,ignore_errors=True),
        )
    except HTTPException:
        shutil.rmtree(tmp_root,ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(tmp_root,ignore_errors=True)
        raise

@app.get('/')
def index():
    return FileResponse(WEB/'index.html')

app.mount('/static',StaticFiles(directory=WEB),name='static')
