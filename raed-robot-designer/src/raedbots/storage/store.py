from __future__ import annotations
import json
import os
import re
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DATA = Path(os.environ.get("RAEDBOTS_DATA_DIR", ROOT / "data" / "projects"))
LOCK = threading.RLock()

def now():
    return datetime.now(timezone.utc).isoformat()

def _p(pid):
    if not re.fullmatch(r"prj-[a-f0-9]{10}", pid):
        raise ValueError("Invalid project ID")
    return DATA / pid / "project.json"

def atomic_json(path, rec):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def create_project(name="New robot project"):
    rec = dict(project_id="prj-" + uuid.uuid4().hex[:10], name=name, created=now(),
               requirements=None, workcell=None, configurations={}, results={}, snapshots={},
               approvals=[], inventory=[], history=[], state="DRAFT", selected_revision=None)
    save(rec)
    return rec

def save(rec):
    with LOCK:
        atomic_json(_p(rec["project_id"]), rec)

def load(pid):
    with LOCK:
        return json.loads(_p(pid).read_text(encoding="utf-8"))

def list_projects():
    out = []
    with LOCK:
        for path in DATA.glob("prj-*/project.json"):
            rec = json.loads(path.read_text(encoding="utf-8"))
            out.append({k: rec.get(k) for k in ("project_id", "name", "created", "state", "selected_revision")})
    return sorted(out, key=lambda r: r["created"], reverse=True)
