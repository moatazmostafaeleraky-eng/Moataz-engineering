import { getAllByProject, getRecord, putRecord } from "../db.js";
import { getCurrentProjectId } from "../state.js";
import { computeValidation } from "./validation.js";
import { esc, badge, gateTrack, emptyState } from "../ui.js";
import { advanceGate } from "../gates.js";
import { toast } from "../toast.js";

const LIMITATIONS = [
  "AI interpretations and recommendations require engineer review.",
  "This report does not replace calibrated laboratory procedures, safety review, regulatory approval, material testing, or responsible-engineer signoff.",
  "Inferred material or component-equivalence claims are not confirmed engineering facts until supported by a label, supplier document, drawing, or test.",
];

export async function render(container) {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    container.innerHTML = emptyState("Select or create a project first.");
    return;
  }
  const project = await getRecord("projects", projectId);
  const [components, measurements, evidence, observations] = await Promise.all([
    getAllByProject("components", projectId),
    getAllByProject("measurements", projectId),
    getAllByProject("evidence", projectId),
    getAllByProject("observations", projectId),
  ]);
  const evidenceIds = new Set(evidence.map((e) => e.evidence_id));
  const validation = computeValidation(components, measurements, evidenceIds);
  const confirmedComparisons = observations.filter((o) => (o.subject_id || "").startsWith("CMP:"));
  const unsyncedCount = [...components, ...measurements, ...evidence, ...observations].filter((r) => r._sync_status && r._sync_status !== "synced").length;

  container.innerHTML = `
    <div class="card">
      <h1>Draft report — ${esc(project.title)}</h1>
      ${gateTrack(project.status)}
      ${unsyncedCount ? `<div class="offline-banner">${unsyncedCount} record(s) are still local-only and have not synced to the server yet.</div>` : ""}
      <h3>Validation</h3>
      <p>${validation.valid ? badge("valid", "green") : badge(`${validation.issues.filter((i) => i.severity === "blocking").length} blocking issue(s)`, "red")}</p>
      <h3>Bill of materials</h3>
      <p>${components.length} component record(s) across ${new Set(components.map((c) => c.product_id)).size} product(s).</p>
      <h3>Confirmed comparisons</h3>
      ${confirmedComparisons.length ? `
        <ul>${confirmedComparisons.map((o) => `<li class="mono">${esc(o.subject_id)} — ${esc((o.text || "").split("|")[0])} (confidence: ${esc(o.confidence)})</li>`).join("")}</ul>
      ` : emptyState("No comparisons confirmed yet.")}
      <h3>Limitations</h3>
      <ul>${LIMITATIONS.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <p>Status: <strong>${esc(project.status)}</strong> (draft until released)</p>
    </div>

    <div class="card">
      <h2>Review gates</h2>
      <p>Recommendations and the final release require explicit engineer sign-off at each remaining gate -- this app never advances a gate automatically.</p>
      <div class="btn-row">
        <button id="advance-decision" ${project.status !== "comparison_ready" ? "disabled" : ""}>Mark decision_reviewed →</button>
        <button id="advance-released" class="primary" ${project.status !== "decision_reviewed" ? "disabled" : ""}>Release →</button>
      </div>
    </div>`;

  container.querySelector("#advance-decision")?.addEventListener("click", async () => {
    try { await advanceGate(project, "decision_reviewed"); toast("Marked decision_reviewed"); render(container); }
    catch (err) { toast(err.message, { error: true }); }
  });
  container.querySelector("#advance-released")?.addEventListener("click", async () => {
    try { await advanceGate(project, "released"); toast("Project released"); render(container); }
    catch (err) { toast(err.message, { error: true }); }
  });
}
