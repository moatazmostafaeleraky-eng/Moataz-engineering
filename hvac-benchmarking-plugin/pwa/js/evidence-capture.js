import { putRecord, enqueueSync } from "./db.js";
import { uid } from "./ids.js";

// A photo/document captured with the device camera or file picker. The Blob
// stays in IndexedDB so the thumbnail renders immediately offline; the sync
// queue entry re-reads it at drain time (see sync.js runMultipart) to build
// the multipart upload.
export async function captureEvidenceFile({ projectId, evidenceType, description, file, linkedTo }) {
  const evidenceId = uid("EVD");
  const record = {
    evidence_id: evidenceId,
    project_id: projectId,
    evidence_type: evidenceType,
    description: description || null,
    linked_to: linkedTo || null,
    uri: null,
    created_at: new Date().toISOString(),
    _sync_status: "pending",
    _blob: file,
    _filename: file.name,
  };
  await putRecord("evidence", record);
  await enqueueSync({
    endpoint: "uploadEvidenceFile",
    kind: "multipart",
    payload: { project_id: projectId, evidence_type: evidenceType, description: description || "", evidence_id: evidenceId },
    blobRef: evidenceId,
    mirrorStore: "evidence",
    mirrorKeyField: "evidence_id",
    localKey: evidenceId,
  });
  return record;
}

// A reference to evidence that already exists elsewhere (a supplier
// document, a catalog page, a slide deck) -- no binary upload, just a URI and
// description, matching /tools/upload_evidence.
export async function linkEvidence({ projectId, evidenceType, uri, description, linkedTo }) {
  const evidenceId = uid("EVD");
  const record = {
    evidence_id: evidenceId,
    project_id: projectId,
    evidence_type: evidenceType,
    uri,
    description: description || null,
    linked_to: linkedTo || null,
    created_at: new Date().toISOString(),
    _sync_status: "pending",
  };
  await putRecord("evidence", record);
  await enqueueSync({
    endpoint: "uploadEvidence",
    payload: { project_id: projectId, evidence_id: evidenceId, evidence_type: evidenceType, uri, description: description || "" },
    mirrorStore: "evidence",
    mirrorKeyField: "evidence_id",
    localKey: evidenceId,
  });
  return record;
}
