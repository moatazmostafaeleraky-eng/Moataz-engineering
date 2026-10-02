from __future__ import annotations

import json
import mimetypes
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory, redirect
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DB = BASE_DIR / "instance" / "benchmark.db"
PWA_DIR = BASE_DIR / "pwa"
EVIDENCE_DIR_NAME = "evidence"

# Review-gate order from the HVAC benchmarking skill. Status may only move
# forward through this sequence (or stay put); it is never skipped or reversed
# from this endpoint, which keeps gate changes an explicit, auditable action.
PROJECT_STATUSES = [
    "draft",
    "capture_complete",
    "data_validated",
    "comparison_ready",
    "decision_reviewed",
    "released",
]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10].upper()}"


def get_db(app: Flask) -> sqlite3.Connection:
    conn = sqlite3.connect(app.config["DATABASE"])
    conn.row_factory = sqlite3.Row
    return conn


def init_db(app: Flask) -> None:
    Path(app.config["DATABASE"]).parent.mkdir(parents=True, exist_ok=True)
    with get_db(app) as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                project_id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL,
                scope TEXT NOT NULL, products TEXT NOT NULL, status TEXT NOT NULL,
                owner TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS checklists (
                checklist_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, scope TEXT NOT NULL,
                items TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS components (
                component_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, product_id TEXT NOT NULL,
                assembly TEXT, parent_component_id TEXT, name TEXT NOT NULL, function TEXT NOT NULL,
                quantity REAL, weight_value REAL, weight_unit TEXT, evidence_state TEXT NOT NULL,
                confidence TEXT, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS evidence (
                evidence_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, evidence_type TEXT NOT NULL,
                uri TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS measurements (
                measurement_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, component_id TEXT NOT NULL,
                parameter TEXT NOT NULL, raw_value REAL NOT NULL, raw_unit TEXT NOT NULL,
                canonical_value REAL, canonical_unit TEXT, source_type TEXT NOT NULL,
                evidence_ids TEXT NOT NULL, uncertainty REAL, status TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS observations (
                observation_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, subject_id TEXT NOT NULL,
                text TEXT NOT NULL, source_type TEXT NOT NULL, evidence_ids TEXT NOT NULL,
                confidence TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL
            );
            """
        )


def row_json(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def parse_json(value: str, default: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default


def evidence_dir(app: Flask) -> Path:
    directory = Path(app.config["DATABASE"]).resolve().parent / EVIDENCE_DIR_NAME
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def make_app(database: str | None = None) -> Flask:
    app = Flask(__name__, static_folder=str(PWA_DIR), static_url_path="/app")
    app.config["DATABASE"] = database or os.environ.get("HVAC_BENCHMARK_DB", str(DEFAULT_DB))
    app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024
    init_db(app)

    def body() -> dict[str, Any]:
        return request.get_json(silent=True) or {}

    def project_or_404(project_id: str):
        with get_db(app) as db:
            row = db.execute("SELECT * FROM projects WHERE project_id=?", (project_id,)).fetchone()
        return row

    @app.get("/health")
    def health():
        return jsonify({"status": "ok", "service": "hvac-benchmarking-plugin", "time": now()})

    @app.post("/tools/create_benchmark_project")
    def create_benchmark_project():
        data = body()
        required = ["title", "scope", "products"]
        missing = [key for key in required if not data.get(key)]
        if missing or len(data.get("products", [])) < 2:
            return jsonify({"error": "title, scope, and at least two products are required", "missing": missing}), 400
        project_id = data.get("project_id", uid("BM"))
        project = {
            "project_id": project_id, "title": data["title"], "revision": int(data.get("revision", 1)),
            "scope": data["scope"], "products": data["products"], "status": "draft",
            "owner": data.get("owner"), "created_at": now()
        }
        with get_db(app) as db:
            db.execute("INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                       (project_id, project["title"], project["revision"], json.dumps(project["scope"]),
                        json.dumps(project["products"]), project["status"], project["owner"], project["created_at"]))
        return jsonify(project), 201

    @app.post("/tools/generate_teardown_checklist")
    def generate_teardown_checklist():
        data = body(); project_id = data.get("project_id"); scope = data.get("scope", [])
        if not project_id or not project_or_404(project_id):
            return jsonify({"error": "valid project_id is required"}), 404
        base = ["overview photos", "nameplate and label photos", "component IDs", "evidence links", "unknowns and conflicts"]
        library = {
            "indoor": ["housing", "air path", "evaporator", "cross-flow fan", "drain system", "PCB and sensors"],
            "outdoor": ["cabinet", "compressor", "condenser", "axial fan and motor", "piping and valves", "electrical box"],
            "performance": ["test method", "ambient conditions", "voltage/frequency", "fan speed", "refrigerant state", "uncertainty"],
            "cost": ["currency/date", "supplier basis", "raw material cost", "cycle cost", "structure cost", "subtotal reconciliation"]
        }
        items = base + [item for group in scope for item in library.get(group, [])]
        checklist = {"checklist_id": uid("CHK"), "project_id": project_id, "scope": scope, "items": items, "created_at": now()}
        with get_db(app) as db:
            db.execute("INSERT INTO checklists VALUES (?, ?, ?, ?, ?)",
                       (checklist["checklist_id"], project_id, json.dumps(scope), json.dumps(items), checklist["created_at"]))
        return jsonify(checklist), 201

    @app.post("/tools/register_component")
    def register_component():
        data = body(); project_id = data.get("project_id")
        if not project_id or not project_or_404(project_id):
            return jsonify({"error": "valid project_id is required"}), 404
        for key in ("product_id", "name", "function"):
            if not data.get(key): return jsonify({"error": f"{key} is required"}), 400
        component_id = data.get("component_id", uid("CMP"))
        payload = dict(data)
        record = (component_id, project_id, data["product_id"], data.get("assembly"), data.get("parent_component_id"),
                  data["name"], data["function"], data.get("quantity", 1),
                  (data.get("weight") or {}).get("value"), (data.get("weight") or {}).get("unit"),
                  data.get("evidence_state", "unknown"), data.get("confidence", "unresolved"),
                  data.get("status", "pending_review"), json.dumps(payload), now())
        with get_db(app) as db:
            db.execute("INSERT INTO components VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", record)
        return jsonify({"component_id": component_id, **payload, "status": record[12]}), 201

    @app.post("/tools/upload_evidence")
    def upload_evidence():
        data = body(); project_id = data.get("project_id")
        if not project_id or not project_or_404(project_id): return jsonify({"error": "valid project_id is required"}), 404
        if not data.get("uri") or not data.get("evidence_type"): return jsonify({"error": "uri and evidence_type are required"}), 400
        evidence = {"evidence_id": data.get("evidence_id", uid("EVD")), "project_id": project_id,
                    "evidence_type": data["evidence_type"], "uri": data["uri"],
                    "description": data.get("description"), "created_at": now()}
        with get_db(app) as db:
            db.execute("INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?)", tuple(evidence.values()))
        return jsonify(evidence), 201

    @app.post("/tools/record_measurement")
    def record_measurement():
        data = body(); project_id = data.get("project_id")
        if not project_id or not project_or_404(project_id): return jsonify({"error": "valid project_id is required"}), 404
        required = ["component_id", "parameter", "raw_value", "raw_unit", "source_type", "evidence_ids"]
        missing = [key for key in required if key not in data]
        if missing: return jsonify({"error": "measurement fields missing", "missing": missing}), 400
        measurement = {"measurement_id": data.get("measurement_id", uid("MEAS")), "project_id": project_id,
                       "component_id": data["component_id"], "parameter": data["parameter"],
                       "raw_value": float(data["raw_value"]), "raw_unit": data["raw_unit"],
                       "canonical_value": data.get("canonical_value", data["raw_value"]),
                       "canonical_unit": data.get("canonical_unit", data["raw_unit"]),
                       "source_type": data["source_type"], "evidence_ids": data["evidence_ids"],
                       "uncertainty": data.get("uncertainty"), "status": data.get("status", "pending_review"), "created_at": now()}
        with get_db(app) as db:
            db.execute("INSERT INTO measurements VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                       (measurement["measurement_id"], project_id, measurement["component_id"], measurement["parameter"],
                        measurement["raw_value"], measurement["raw_unit"], measurement["canonical_value"], measurement["canonical_unit"],
                        measurement["source_type"], json.dumps(measurement["evidence_ids"]), measurement["uncertainty"],
                        measurement["status"], measurement["created_at"]))
        return jsonify(measurement), 201

    @app.post("/tools/record_observation")
    def record_observation():
        data = body(); project_id = data.get("project_id")
        if not project_id or not project_or_404(project_id): return jsonify({"error": "valid project_id is required"}), 404
        if not data.get("subject_id") or not data.get("text"): return jsonify({"error": "subject_id and text are required"}), 400
        observation = {"observation_id": data.get("observation_id", uid("OBS")), "project_id": project_id,
                       "subject_id": data["subject_id"], "text": data["text"],
                       "source_type": data.get("source_type", "observed"), "evidence_ids": data.get("evidence_ids", []),
                       "confidence": data.get("confidence", "medium"), "status": "pending_review", "created_at": now()}
        with get_db(app) as db:
            db.execute("INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", tuple(observation.values()))
        return jsonify(observation), 201

    @app.post("/tools/validate_project")
    def validate_project():
        data = body(); project_id = data.get("project_id")
        if not project_id or not project_or_404(project_id): return jsonify({"error": "valid project_id is required"}), 404
        issues = []
        with get_db(app) as db:
            components = db.execute("SELECT * FROM components WHERE project_id=?", (project_id,)).fetchall()
            measurements = db.execute("SELECT * FROM measurements WHERE project_id=?", (project_id,)).fetchall()
            evidence = {row["evidence_id"] for row in db.execute("SELECT evidence_id FROM evidence WHERE project_id=?", (project_id,))}
        if not components: issues.append({"severity": "blocking", "code": "NO_COMPONENTS", "message": "No component records exist."})
        for row in components:
            if row["evidence_state"] == "unknown": issues.append({"severity": "warning", "code": "COMPONENT_UNKNOWN", "component_id": row["component_id"], "message": "Component evidence state is unknown."})
        for row in measurements:
            missing = [eid for eid in parse_json(row["evidence_ids"], []) if eid not in evidence]
            if missing: issues.append({"severity": "blocking", "code": "MISSING_EVIDENCE", "measurement_id": row["measurement_id"], "missing_evidence_ids": missing})
            if row["source_type"] in ("measured", "documented") and row["canonical_value"] is None:
                issues.append({"severity": "blocking", "code": "NO_CANONICAL_VALUE", "measurement_id": row["measurement_id"]})
        return jsonify({"project_id": project_id, "valid": not any(i["severity"] == "blocking" for i in issues), "issues": issues}), 200

    @app.post("/tools/generate_bom")
    def generate_bom():
        data = body(); project_id = data.get("project_id")
        if not project_id or not project_or_404(project_id): return jsonify({"error": "valid project_id is required"}), 404
        with get_db(app) as db:
            rows = db.execute("SELECT * FROM components WHERE project_id=? ORDER BY product_id, assembly, component_id", (project_id,)).fetchall()
        items = [dict(row) for row in rows]
        return jsonify({"project_id": project_id, "component_count": len(items), "items": items}), 200

    @app.post("/tools/compare_products")
    def compare_products():
        data = body(); project_id = data.get("project_id"); parameter = data.get("parameter")
        our_id = data.get("our_product_id"); competitor_id = data.get("competitor_product_id")
        if not project_id or not project_or_404(project_id): return jsonify({"error": "valid project_id is required"}), 404
        if not parameter or not our_id or not competitor_id: return jsonify({"error": "parameter and both product IDs are required"}), 400
        with get_db(app) as db:
            ours = db.execute("SELECT * FROM measurements m JOIN components c ON c.component_id=m.component_id WHERE m.project_id=? AND c.product_id=? AND m.parameter=? AND m.status='accepted' ORDER BY m.created_at DESC LIMIT 1", (project_id, our_id, parameter)).fetchone()
            comp = db.execute("SELECT * FROM measurements m JOIN components c ON c.component_id=m.component_id WHERE m.project_id=? AND c.product_id=? AND m.parameter=? AND m.status='accepted' ORDER BY m.created_at DESC LIMIT 1", (project_id, competitor_id, parameter)).fetchone()
        if not ours or not comp: return jsonify({"project_id": project_id, "parameter": parameter, "comparability": "not_comparable", "reason": "accepted measurements for both products are required"}), 200
        if ours["canonical_unit"] != comp["canonical_unit"]: return jsonify({"comparability": "not_comparable", "reason": "canonical units differ"}), 200
        delta = comp["canonical_value"] - ours["canonical_value"]
        pct = (delta / ours["canonical_value"] * 100) if ours["canonical_value"] else None
        return jsonify({"project_id": project_id, "parameter": parameter, "our_value": ours["canonical_value"], "competitor_value": comp["canonical_value"], "unit": ours["canonical_unit"], "absolute_delta": delta, "percentage_delta": pct, "formula": "(competitor - our) / our * 100", "comparability": "comparable", "evidence_ids": parse_json(ours["evidence_ids"], []) + parse_json(comp["evidence_ids"], []), "review_status": "pending_review"}), 200

    @app.post("/tools/calculate_kpis")
    def calculate_kpis():
        data = body(); values = data.get("values", {})
        result = {"requested": list(values), "calculated": {}}
        if values.get("performance") is not None and values.get("mass"):
            result["calculated"]["performance_per_mass"] = values["performance"] / values["mass"]
        if values.get("performance") is not None and values.get("input_power"):
            result["calculated"]["performance_per_power"] = values["performance"] / values["input_power"]
        if values.get("component_cost") is not None and values.get("total_cost"):
            result["calculated"]["cost_share_pct"] = values["component_cost"] / values["total_cost"] * 100
        result["status"] = "calculated_with_formula"; return jsonify(result), 200

    @app.post("/tools/generate_report")
    def generate_report():
        data = body(); project_id = data.get("project_id")
        if not project_id or not project_or_404(project_id): return jsonify({"error": "valid project_id is required"}), 404
        validation_response = validate_project()
        bom_response = generate_bom()
        validation = (validation_response[0] if isinstance(validation_response, tuple) else validation_response).get_json()
        bom = (bom_response[0] if isinstance(bom_response, tuple) else bom_response).get_json()
        report = {"project_id": project_id, "title": data.get("title", "HVAC Benchmark Report"), "validation": validation, "bom": bom, "limitations": ["AI interpretations and recommendations require engineer review."], "status": "draft"}
        return jsonify(report), 200

    @app.post("/tools/update_project_status")
    def update_project_status():
        data = body(); project_id = data.get("project_id"); status = data.get("status")
        row = project_or_404(project_id) if project_id else None
        if not row: return jsonify({"error": "valid project_id is required"}), 404
        if status not in PROJECT_STATUSES: return jsonify({"error": "status must be one of the review gates", "allowed": PROJECT_STATUSES}), 400
        if PROJECT_STATUSES.index(status) < PROJECT_STATUSES.index(row["status"]):
            return jsonify({"error": "status cannot move backward through the review gates", "current": row["status"]}), 400
        with get_db(app) as db:
            db.execute("UPDATE projects SET status=? WHERE project_id=?", (status, project_id))
        return jsonify({"project_id": project_id, "status": status, "updated_at": now()}), 200

    @app.post("/tools/upload_evidence_file")
    def upload_evidence_file():
        project_id = request.form.get("project_id")
        if not project_id or not project_or_404(project_id): return jsonify({"error": "valid project_id is required"}), 404
        evidence_type = request.form.get("evidence_type")
        uploaded = request.files.get("file")
        if not evidence_type or not uploaded or not uploaded.filename:
            return jsonify({"error": "evidence_type and file are required"}), 400
        evidence_id = request.form.get("evidence_id") or uid("EVD")
        suffix = Path(secure_filename(uploaded.filename)).suffix
        stored_name = f"{evidence_id}{suffix}"
        uploaded.save(evidence_dir(app) / stored_name)
        evidence = {"evidence_id": evidence_id, "project_id": project_id, "evidence_type": evidence_type,
                    "uri": f"/evidence/{evidence_id}/file", "description": request.form.get("description"), "created_at": now()}
        with get_db(app) as db:
            db.execute("INSERT OR REPLACE INTO evidence VALUES (?, ?, ?, ?, ?, ?)", tuple(evidence.values()))
        return jsonify(evidence), 201

    @app.get("/evidence/<evidence_id>/file")
    def get_evidence_file(evidence_id: str):
        directory = evidence_dir(app)
        matches = sorted(directory.glob(f"{evidence_id}.*"))
        if not matches: return jsonify({"error": "evidence file not found"}), 404
        mimetype, _ = mimetypes.guess_type(matches[0].name)
        return send_from_directory(directory, matches[0].name, mimetype=mimetype)

    @app.get("/")
    def root():
        return redirect("/app/")

    @app.get("/app/")
    def pwa_index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/projects/<project_id>")
    def get_project(project_id: str):
        row = project_or_404(project_id)
        if not row: return jsonify({"error": "project not found"}), 404
        with get_db(app) as db:
            components = [row_json(r) for r in db.execute("SELECT * FROM components WHERE project_id=?", (project_id,)).fetchall()]
            measurements = [row_json(r) for r in db.execute("SELECT * FROM measurements WHERE project_id=?", (project_id,)).fetchall()]
        project = row_json(row); project["scope"] = parse_json(project["scope"], []); project["products"] = parse_json(project["products"], [])
        return jsonify({"project": project, "components": components, "measurements": measurements}), 200

    return app


app = make_app()

if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "5050")), debug=False)
