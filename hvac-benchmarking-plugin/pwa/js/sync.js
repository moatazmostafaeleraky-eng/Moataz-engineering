// Background sync engine. Nothing in this app talks to the network directly
// from a view -- views write to IndexedDB and enqueue a sync job; this module
// drains that queue whenever the device is online, in FIFO order per project
// so a project is never created after its own components try to sync.

import { getPendingSync, updateSyncEntry, putRecord, getRecord } from "./db.js";
import { callByEndpoint, checkOnline, api } from "./api.js";

const listeners = new Set();
let draining = false;
let online = navigator.onLine;

export function onSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(status) {
  for (const fn of listeners) fn(status);
}

export function isOnline() {
  return online;
}

async function refreshOnlineState() {
  online = navigator.onLine && (await checkOnline());
  emit({ type: "connectivity", online });
  return online;
}

// Writes the server's response back onto the matching local record so
// server-computed fields (canonical values the server recalculated,
// timestamps, status) stay the source of truth once a sync succeeds.
async function applyServerResult(entry, result) {
  if (!entry.mirrorStore) return;
  const key = result[entry.mirrorKeyField] ?? entry.localKey;
  const existing = (key && (await getRecord(entry.mirrorStore, key))) || {};
  await putRecord(entry.mirrorStore, { ...existing, ...result, _sync_status: "synced" });
}

// Evidence files are captured as Blobs straight into IndexedDB (see
// evidence-capture.js) so the photo is usable offline immediately; only at
// sync time do we read that Blob back out and build the multipart request
// the backend's /tools/upload_evidence_file route expects.
async function runMultipart(entry) {
  const record = await getRecord("evidence", entry.blobRef);
  if (!record || !record._blob) throw new Error("evidence blob missing locally");
  const form = new FormData();
  for (const [key, value] of Object.entries(entry.payload)) {
    if (value !== undefined && value !== null) form.append(key, value);
  }
  form.append("file", record._blob, record._filename || "evidence.jpg");
  return api.uploadEvidenceFile(form);
}

export async function drainQueue() {
  if (draining) return;
  draining = true;
  emit({ type: "sync-start" });
  try {
    const ok = await refreshOnlineState();
    if (!ok) return;
    const pending = (await getPendingSync())
      .filter((e) => e.status === "pending" || e.status === "failed")
      .sort((a, b) => a.seq - b.seq);
    for (const entry of pending) {
      try {
        await updateSyncEntry(entry.seq, { status: "syncing" });
        const result = entry.kind === "multipart" ? await runMultipart(entry) : await callByEndpoint(entry.endpoint, entry.payload);
        await applyServerResult(entry, result);
        await updateSyncEntry(entry.seq, { status: "done", last_error: null });
        emit({ type: "item-synced", entry });
      } catch (err) {
        await updateSyncEntry(entry.seq, {
          status: "failed",
          attempts: (entry.attempts || 0) + 1,
          last_error: String(err && err.message ? err.message : err),
        });
        emit({ type: "item-failed", entry, error: err });
        // Stop at the first failure for this drain pass if it is a
        // dependency failure (e.g. project not yet synced) -- retrying later
        // items from the same project before their parent exists would just
        // recreate the same error. Keep draining for unrelated projects.
      }
    }
  } finally {
    draining = false;
    emit({ type: "sync-end" });
  }
}

export function startAutoSync() {
  window.addEventListener("online", () => drainQueue());
  window.addEventListener("offline", () => {
    online = false;
    emit({ type: "connectivity", online: false });
  });
  refreshOnlineState().then((ok) => {
    if (ok) drainQueue();
  });
  // Belt-and-suspenders poll: some tablets fire flaky online/offline events
  // on captive-portal Wi-Fi, so re-check periodically rather than trusting
  // the browser events alone.
  setInterval(() => {
    refreshOnlineState().then((ok) => ok && drainQueue());
  }, 20000);
}
