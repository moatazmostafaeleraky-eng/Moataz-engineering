import hashlib
import json
import time
import zipfile
import io
import pytest
from fastapi.testclient import TestClient
from raedbots.api.app import app
from raedbots.api import jobs,service
from raedbots.configuration.engine import default_requirements,propose
from raedbots.configuration.validation import validate
from raedbots.domain.models import Workcell
from raedbots.storage import store
from raedbots.assistant.parse import parse_requirements
from raedbots.procurement.egypt import html_report

@pytest.fixture
def client(tmp_path,monkeypatch):
    monkeypatch.setattr(store,'DATA',tmp_path/'projects')
    with TestClient(app) as c:
        yield c
    deadline=time.monotonic()+90
    while jobs.ACTIVE and time.monotonic()<deadline:time.sleep(.02)
    assert not jobs.ACTIVE

def setup_project(c):
    response=c.post('/api/projects',json={'name':'اختبار'});assert response.status_code==201
    pid=response.json()['project_id']
    defaults=c.get('/api/defaults').json()
    r=c.post(f'/api/projects/{pid}/configurations',json=defaults);assert r.status_code==201,r.text
    return pid,r.json()['revision_id'],defaults

def wait(c,job):
    jid=job['job_id'];deadline=time.monotonic()+90
    while time.monotonic()<deadline:
        rec=c.get(f'/api/jobs/{jid}').json()
        if rec['status'] in ['succeeded','failed','cancelled']:
            assert rec['status']=='succeeded',rec
            return rec['result']
        time.sleep(.03)
    pytest.fail('Job timeout')

def test_full_project_calculation_review_and_export(client):
    c=client;pid,rid,data=setup_project(c);base=f'/api/projects/{pid}/revisions/{rid}'
    assert c.post(base+'/exports',json={}).status_code==409
    wait(c,c.post(base+'/calculations',json={}).json())
    rep=c.get(base+'/reports').json();assert len(rep['bom'])>15
    assert rep['coverage']['verified_or_standard']==0
    assert all(r['checked_on'] is None for r in rep['procurement'])
    assert c.post(base+'/reviews',json={'purpose':'manufacturing','reviewer':'Engineer'}).status_code==409
    review=c.post(base+'/reviews',json={'reviewer':'Engineer'}).json()
    assert c.post(base+'/reviews',json={'reviewer':'Engineer'}).json()['approval_id']==review['approval_id']
    result=wait(c,c.post(base+'/exports',json={}).json())
    blob=c.get(result['download_url']);assert blob.status_code==200
    with zipfile.ZipFile(io.BytesIO(blob.content)) as z:
        manifest=json.loads(z.read('manifest.json'))
        assert manifest['revision_id']==rid
        assert manifest['designed_by']=='Moataz Mostafa'
        assert manifest['copyright_notice']=='Designed by: Moataz Mostafa'
        assert z.read('COPYRIGHT.txt').decode().strip()=='Designed by: Moataz Mostafa\nAll rights reserved.'
        assert 'Designed by: Moataz Mostafa' in z.read('README.txt').decode()
        for path,digest in manifest['files'].items():
            assert hashlib.sha256(z.read(path)).hexdigest()==digest
        assert 'FOR ENGINEERING REVIEW ONLY' in z.read('README.txt').decode()
    data['requirements']['workpiece_mass_kg']['value']=7
    new=c.post(f'/api/projects/{pid}/configurations',json=data).json()['revision_id']
    rec=c.get(f'/api/projects/{pid}').json()
    assert rec['snapshots'][rid]['data']['requirements']['workpiece_mass_kg']['value']==6
    assert rec['selected_revision']==new and rec['state']=='DRAFT'
    assert c.post(f'/api/projects/{pid}/revisions/{new}/exports',json={}).status_code==409

def test_invalid_units_ids_and_cross_origin_are_rejected(client):
    c=client;pid,rid,data=setup_project(c)
    data['requirements']['reach_m']['unit']='mm'
    assert c.post(f'/api/projects/{pid}/configurations',json=data).status_code==422
    data['requirements']['reach_m']['unit']='m';data['requirements']['locked_tool_id']='missing'
    assert c.post(f'/api/projects/{pid}/configurations',json=data).status_code==422
    assert c.post('/api/projects',json={'name':'bad'},headers={'Origin':'https://untrusted.example'}).status_code==403
    assert c.get('/api/projects/not-a-project').status_code==422

def test_calculation_of_old_revision_does_not_select_it(client):
    c=client;pid,rid,data=setup_project(c)
    new=c.post(f'/api/projects/{pid}/configurations',json=data).json()['revision_id']
    wait(c,c.post(f'/api/projects/{pid}/revisions/{rid}/calculations',json={}).json())
    rec=c.get(f'/api/projects/{pid}').json()
    assert rec['selected_revision']==new and rec['state']=='DRAFT'
    assert rid in rec['results']

def test_optimization_keeps_unknown_candidates_out_of_pareto(client):
    c=client;pid,rid,data=setup_project(c)
    result=wait(c,c.post('/api/optimization/jobs',json={'project_id':pid,'revision_id':rid,'limit':2}).json())
    assert len(result['candidates'])==2
    assert result['pareto_ids']==[]
    assert c.get(f'/api/projects/{pid}').json()['selected_revision']==rid

def test_parser_does_not_read_mm_as_metres():
    assert parse_requirements('accuracy 10mm')['requirements']['reach_m']['value']==1.2
    assert parse_requirements('وصول ١.٥ متر')['requirements']['reach_m']['value']==1.5

def test_store_rejects_traversal():
    with pytest.raises(ValueError):store.load('../outside')

def test_procurement_report_escapes_values():
    text=html_report([{'part_number':'<script>alert(1)</script>','report_generated_on':'today'}])
    assert '<script>' not in text and '&lt;script&gt;' in text

def test_designer_attribution_is_present_in_app_and_project_notice():
    from pathlib import Path
    root=Path(__file__).resolve().parents[1]
    page=(root/'src'/'raedbots'/'web'/'index.html').read_text(encoding='utf-8')
    notice=(root/'COPYRIGHT.txt').read_text(encoding='utf-8')
    assert 'Designed by: Moataz Mostafa' in page
    assert 'Designed by: Moataz Mostafa' in notice

def test_instruction_defined_workflow_modes_are_present():
    from pathlib import Path
    root=Path(__file__).resolve().parents[1]
    page=(root/'src'/'raedbots'/'web'/'index.html').read_text(encoding='utf-8')
    script=(root/'src'/'raedbots'/'web'/'app.js').read_text(encoding='utf-8')
    for mode in ['design','benchmark','actuator','compare']:
        assert f'data-mode="{mode}"' in page
    for tab in ['design','checks','benchmark','bom','compare','export']:
        assert f'id="tab-{tab}"' in page
    assert 'defaultTabForMode' in script
    assert 'PRIMARY' in page and 'fallback shell preview' in page
    assert 'No encoder items in the current catalog' in script
