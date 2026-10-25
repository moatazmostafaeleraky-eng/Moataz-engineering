import time
import numpy as np
from fastapi.testclient import TestClient
import pytest
from raedbots.api.app import app
from raedbots.api import jobs
from raedbots.catalog import loader
from raedbots.configuration.engine import default_requirements, propose
from raedbots.domain.models import Workcell
from raedbots.engineering.evaluate import static_gravity_torques
from raedbots.engineering.sizing import axis_sizing, computed_reach
from raedbots.storage import store


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(store, 'DATA', tmp_path / 'projects')
    with TestClient(app) as c:
        yield c
    deadline = time.monotonic() + 90
    while jobs.ACTIVE and time.monotonic() < deadline:
        time.sleep(.02)


def calculated_revision(c):
    pid = c.post('/api/projects', json={'name': 'R-1 class'}).json()['project_id']
    rid = c.post(f'/api/projects/{pid}/configurations', json=c.get('/api/defaults').json()).json()['revision_id']
    jid = c.post(f'/api/projects/{pid}/revisions/{rid}/calculations').json()['job_id']
    deadline = time.monotonic() + 60
    while c.get(f'/api/jobs/{jid}').json()['status'] != 'succeeded':
        assert time.monotonic() < deadline
        time.sleep(.05)
    return pid, rid


def test_capacity_is_the_largest_mass_every_axis_holds():
    req = default_requirements()
    cfg = propose(req)
    result = axis_sizing(cfg, req, Workcell())
    cap = result['static_payload_capacity_kg']
    limiting = result['axes'][int(result['limiting_axis'][1:]) - 1]
    assert cap == pytest.approx(limiting['static_tcp_capacity_kg'])
    # The worst-case torque reported for each axis is at least the nominal-posture value.
    for axis in result['axes']:
        assert axis['worst_case_torque_nm'] + 1e-9 >= axis['nominal_torque_nm'] or axis['nominal_torque_nm'] < 1e-6
        assert axis['required_static_nm_at_rated_payload'] >= 0


def test_torque_is_affine_in_tcp_mass():
    req = default_requirements()
    cfg = propose(req)
    q = np.radians([10, 40, -20, 5, 30, 0])
    t0, t1, t5 = (np.array(static_gravity_torques(cfg, req, Workcell(), q, workpiece_kg=m)) for m in (0, 1, 5))
    assert np.allclose(t5, t0 + 5 * (t1 - t0))


def test_reach_matches_planar_geometry_of_medium_family():
    rows = loader.families()['medium'].dh
    reach = computed_reach(rows)
    # a2 + |(a3, d4)| for a straight arm; sampled sweep may undershoot slightly.
    expected = rows[1].a_m + float(np.hypot(rows[2].a_m, rows[3].d_m))
    assert reach['wrist_centre_m'] == pytest.approx(expected, abs=0.01)
    assert reach['flange_m'] > reach['wrist_centre_m']


def test_sizing_benchmark_and_pdf_endpoints(client):
    pid, rid = calculated_revision(client)
    s = client.get(f'/api/projects/{pid}/revisions/{rid}/actuator-sizing')
    assert s.status_code == 200 and len(s.json()['axes']) == 6
    refs = client.get('/api/benchmark/references').json()['references']
    assert {r['id'] for r in refs} >= {'raed-r1', 'yaskawa-up6'}
    b = client.post(f'/api/projects/{pid}/revisions/{rid}/benchmark',
                    json={'extra_references': [{'name': 'Imported ABB', 'payload_kg': 10, 'reach_m': 1.45}]})
    assert b.status_code == 200, b.text
    data = b.json()
    assert any(r['name'] == 'Imported ABB' for r in data['references'])
    assert all(g['status'] in {'pass', 'fail', 'unknown'} for g in data['target_checks'])
    pdf = client.get(f'/api/projects/{pid}/revisions/{rid}/report.pdf')
    assert pdf.status_code == 200 and pdf.content.startswith(b'%PDF')


def test_sizing_requires_calculation(client):
    pid = client.post('/api/projects', json={'name': 'x'}).json()['project_id']
    rid = client.post(f'/api/projects/{pid}/configurations', json=client.get('/api/defaults').json()).json()['revision_id']
    assert client.get(f'/api/projects/{pid}/revisions/{rid}/actuator-sizing').status_code == 409
