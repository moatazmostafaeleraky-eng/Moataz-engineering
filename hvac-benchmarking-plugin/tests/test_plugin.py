import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import make_app


def client(tmp_path):
    app = make_app(str(tmp_path / "test.db"))
    app.config["TESTING"] = True
    return app.test_client()


def test_end_to_end_outdoor_motor(tmp_path):
    c = client(tmp_path)
    response = c.post("/tools/create_benchmark_project", json={
        "project_id": "BM-TEST-001",
        "title": "Outdoor motor comparison",
        "scope": ["outdoor", "cost"],
        "products": [
            {"product_id": "OUR", "owner_type": "our_product", "model": "OUR-INV", "category": "split"},
            {"product_id": "COMP", "owner_type": "competitor", "model": "COMP-ELA", "category": "split"}
        ]
    })
    assert response.status_code == 201
    assert c.post("/tools/generate_teardown_checklist", json={"project_id": "BM-TEST-001", "scope": ["outdoor", "cost"]}).status_code == 201

    for product, name in [("OUR", "8-pole outdoor motor"), ("COMP", "10-pole outdoor motor")]:
        assert c.post("/tools/register_component", json={
            "project_id": "BM-TEST-001", "product_id": product, "component_id": f"CMP-{product}",
            "assembly": "outdoor_unit", "name": name, "function": "condenser airflow",
            "evidence_state": "documented", "confidence": "medium", "status": "accepted"
        }).status_code == 201

    evidence = c.post("/tools/upload_evidence", json={
        "project_id": "BM-TEST-001", "evidence_id": "EVD-MOTOR", "evidence_type": "benchmark_slide",
        "uri": "260811 Benchmark Activity Detailed (1).pptx", "description": "motor cost note"
    })
    assert evidence.status_code == 201

    for component, value in [("CMP-OUR", 5.2), ("CMP-COMP", 4.4)]:
        assert c.post("/tools/record_measurement", json={
            "project_id": "BM-TEST-001", "component_id": component, "parameter": "motor_cost",
            "raw_value": value, "raw_unit": "USD", "canonical_value": value, "canonical_unit": "USD",
            "source_type": "documented", "evidence_ids": ["EVD-MOTOR"], "status": "accepted"
        }).status_code == 201

    validation = c.post("/tools/validate_project", json={"project_id": "BM-TEST-001"}).get_json()
    assert validation["valid"] is True

    comparison = c.post("/tools/compare_products", json={
        "project_id": "BM-TEST-001", "parameter": "motor_cost",
        "our_product_id": "OUR", "competitor_product_id": "COMP"
    }).get_json()
    assert comparison["comparability"] == "comparable"
    assert round(comparison["absolute_delta"], 2) == -0.8
    assert round(comparison["percentage_delta"], 2) == -15.38

    bom = c.post("/tools/generate_bom", json={"project_id": "BM-TEST-001"}).get_json()
    assert bom["component_count"] == 2
    report = c.post("/tools/generate_report", json={"project_id": "BM-TEST-001"}).get_json()
    assert report["status"] == "draft"
    assert report["validation"]["valid"] is True


def test_validation_flags_missing_evidence(tmp_path):
    c = client(tmp_path)
    project = c.post("/tools/create_benchmark_project", json={
        "title": "Validation test", "scope": ["outdoor"],
        "products": [{"product_id": "A"}, {"product_id": "B"}]
    }).get_json()
    pid = project["project_id"]
    c.post("/tools/register_component", json={"project_id": pid, "product_id": "A", "name": "fan", "function": "airflow", "status": "accepted"})
    comp = c.get(f"/projects/{pid}").get_json()["components"][0]
    c.post("/tools/record_measurement", json={
        "project_id": pid, "component_id": comp["component_id"], "parameter": "diameter",
        "raw_value": 400, "raw_unit": "mm", "source_type": "measured", "evidence_ids": ["MISSING"]
    })
    validation = c.post("/tools/validate_project", json={"project_id": pid}).get_json()
    assert validation["valid"] is False
    assert any(issue["code"] == "MISSING_EVIDENCE" for issue in validation["issues"])


def test_update_project_status_moves_forward_only(tmp_path):
    c = client(tmp_path)
    project = c.post("/tools/create_benchmark_project", json={
        "title": "Gate test", "scope": ["outdoor"],
        "products": [{"product_id": "A"}, {"product_id": "B"}]
    }).get_json()
    pid = project["project_id"]
    assert project["status"] == "draft"

    ok = c.post("/tools/update_project_status", json={"project_id": pid, "status": "capture_complete"})
    assert ok.status_code == 200
    assert ok.get_json()["status"] == "capture_complete"

    backward = c.post("/tools/update_project_status", json={"project_id": pid, "status": "draft"})
    assert backward.status_code == 400

    bad_status = c.post("/tools/update_project_status", json={"project_id": pid, "status": "not_a_gate"})
    assert bad_status.status_code == 400

    missing_project = c.post("/tools/update_project_status", json={"project_id": "BM-NOPE", "status": "draft"})
    assert missing_project.status_code == 404


def test_upload_evidence_file_stores_and_serves_the_file(tmp_path):
    c = client(tmp_path)
    project = c.post("/tools/create_benchmark_project", json={
        "title": "Evidence file test", "scope": ["outdoor"],
        "products": [{"product_id": "A"}, {"product_id": "B"}]
    }).get_json()
    pid = project["project_id"]

    data = {
        "project_id": pid,
        "evidence_type": "photo",
        "description": "nameplate",
        "file": (io.BytesIO(b"fake-jpeg-bytes"), "nameplate.jpg"),
    }
    response = c.post("/tools/upload_evidence_file", data=data, content_type="multipart/form-data")
    assert response.status_code == 201
    evidence = response.get_json()
    assert evidence["evidence_type"] == "photo"
    assert evidence["uri"].startswith("/evidence/")

    fetched = c.get(evidence["uri"])
    assert fetched.status_code == 200
    assert fetched.data == b"fake-jpeg-bytes"


def test_pwa_shell_is_served(tmp_path):
    c = client(tmp_path)
    root = c.get("/")
    assert root.status_code in (301, 302)
    index = c.get("/app/")
    assert index.status_code == 200
    assert b"HVAC" in index.data
