import { getAllByProject } from "../db.js";
import { getCurrentProjectId } from "../state.js";
import { captureEvidenceFile, linkEvidence } from "../evidence-capture.js";
import { esc, options, EVIDENCE_TYPES, emptyState } from "../ui.js";
import { toast } from "../toast.js";

function thumbSrc(record) {
  if (record._blob) return URL.createObjectURL(record._blob);
  if (record.uri && record.uri.startsWith("/evidence/")) return record.uri;
  return null;
}

export async function render(container) {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    container.innerHTML = emptyState("Select or create a project first.");
    return;
  }
  const evidence = (await getAllByProject("evidence", projectId)).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  container.innerHTML = `
    <div class="card">
      <h1>Evidence</h1>
      <p>Photos, labels, documents, and test files. Every component or measurement claim should point back to one of these evidence IDs -- unsupported claims are rejected at validation.</p>
      <div class="evidence-grid">
        ${evidence.length ? evidence.map((e) => {
          const src = thumbSrc(e);
          return `
          <div class="evidence-thumb" title="${esc(e.description || "")}">
            ${src ? `<img src="${src}" alt="${esc(e.evidence_type)}">` : `<span class="mono">${esc(e.evidence_type)}</span>`}
            <span class="badge badge-neutral ev-type">${esc(e.evidence_type)}</span>
            ${e._sync_status !== "synced" ? `<span class="pending-flag ev-pending">local</span>` : ""}
          </div>`;
        }).join("") : emptyState("No evidence captured yet.")}
      </div>
    </div>

    <div class="card">
      <h2>Capture photo / label</h2>
      <form id="capture-form" class="stack">
        <div class="row">
          <div class="field">
            <label for="cap-type">Evidence type</label>
            <select id="cap-type" name="evidence_type">${options(EVIDENCE_TYPES, "photo")}</select>
          </div>
          <div class="field">
            <label for="cap-file">Photo</label>
            <input id="cap-file" name="file" type="file" accept="image/*" capture="environment" required>
          </div>
        </div>
        <div class="field">
          <label for="cap-desc">Description</label>
          <input id="cap-desc" name="description" placeholder="e.g. nameplate, outdoor unit, left side">
        </div>
        <div class="btn-row"><button type="submit" class="primary">Save evidence</button></div>
      </form>
    </div>

    <div class="card">
      <h2>Link a document</h2>
      <p>For a supplier document, catalog page, or benchmark slide deck that already exists as a file name or reference.</p>
      <form id="link-form" class="stack">
        <div class="row">
          <div class="field">
            <label for="link-type">Evidence type</label>
            <select id="link-type" name="evidence_type">${options(EVIDENCE_TYPES, "document")}</select>
          </div>
          <div class="field">
            <label for="link-uri">Reference (file name / URL / doc ID)</label>
            <input id="link-uri" name="uri" required placeholder="260811 Benchmark Activity Detailed.pptx">
          </div>
        </div>
        <div class="field">
          <label for="link-desc">Description</label>
          <input id="link-desc" name="description">
        </div>
        <div class="btn-row"><button type="submit" class="primary">Save reference</button></div>
      </form>
    </div>`;

  container.querySelector("#capture-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const file = form.file.files[0];
    if (!file) return toast("Choose or take a photo first", { error: true });
    await captureEvidenceFile({
      projectId,
      evidenceType: form.evidence_type.value,
      description: form.description.value.trim(),
      file,
    });
    toast("Evidence saved (queued to sync)");
    render(container);
  });

  container.querySelector("#link-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    await linkEvidence({
      projectId,
      evidenceType: form.evidence_type.value,
      uri: form.uri.value.trim(),
      description: form.description.value.trim(),
    });
    toast("Reference saved (queued to sync)");
    render(container);
  });
}
