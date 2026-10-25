from concurrent.futures import ThreadPoolExecutor
from threading import RLock
import json
import re
import uuid
from raedbots.storage import store

POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="raed-job")
LOCK = RLock()
ACTIVE = {}

class Cancelled(Exception):
    pass

def path(jid):
    if not re.fullmatch(r"job-[a-f0-9]{12}", jid):
        raise ValueError("Invalid job ID")
    return store.DATA.parent / "jobs" / f"{jid}.json"

def get(jid):
    with LOCK:
        rec = json.loads(path(jid).read_text(encoding="utf-8"))
        if rec["status"] in {"queued","running"} and jid not in ACTIVE:
            rec.update(status="failed", error="Application restarted before this job completed")
            store.atomic_json(path(jid), rec)
        return rec

def cancel(jid):
    with LOCK:
        rec=get(jid)
        if rec["status"] in {"queued","running"}:
            rec["cancel_requested"]=True
            store.atomic_json(path(jid),rec)
        return rec

def submit(kind, pid, rid, fn):
    with LOCK:
        for jid in list(ACTIVE):
            old=get(jid)
            if (old['kind'],old['project_id'],old['revision_id']) == (kind,pid,rid) and not old.get('cancel_requested'):
                return old
        if len(ACTIVE)>=8:
            raise ValueError("Job queue is full; wait for a running job")
        jid="job-"+uuid.uuid4().hex[:12]
        rec=dict(job_id=jid,kind=kind,project_id=pid,revision_id=rid,status="queued",progress=0,
                 created=store.now(),cancel_requested=False,result=None,error=None)
        store.atomic_json(path(jid),rec)
        ACTIVE[jid]=True

    def progress(value, message):
        with LOCK:
            current=get(jid)
            if current.get('cancel_requested'):
                raise Cancelled()
            current.update(status="running",progress=value,message=message)
            store.atomic_json(path(jid),current)

    def work():
        try:
            progress(1,"Starting")
            result=fn(progress)
            with LOCK:
                current=get(jid)
                current.update(status="succeeded",progress=100,result=result,finished=store.now())
                store.atomic_json(path(jid),current)
        except Exception as exc:
            with LOCK:
                current=get(jid)
                current.update(status="cancelled" if isinstance(exc,Cancelled) else "failed",
                               error=None if isinstance(exc,Cancelled) else str(exc),finished=store.now())
                store.atomic_json(path(jid),current)
        finally:
            with LOCK:
                ACTIVE.pop(jid,None)
    POOL.submit(work)
    return rec
