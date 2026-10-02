import { getAllByProject, getRecord, putRecord } from "../db.js";
import { getCurrentProjectId } from "../state.js";
import { esc, badge, gateTrack, emptyState } from "../ui.js";
import { advanceGate } from "../gates.js";
import { toast } from "../toast.js";

// Mirrors validate_project() in app.py exactly, so a technician gets the same
// blocking/warning verdict offline as the server would compute once synced.
export function computeValidation(components, measurements, evidenceIds) {
  const issues = [];
  if (!components.length) issues.push({ severity: "blocking", code: "NO_COMPONENTS", message: "No component records exist." });
  for (const c of components) {
    if (c.evidence_state === "unknown") issues.push({ severity: "warning", code: "COMPONENT_UNKNOWN", component_id: c.component_id, message: "Component evidence state is unknown." });
  }
  for (const m of measurements) {
    const missing = (m.evidence_ids || []).filter((id) => !evidenceIds.has(id));
    if (missing.length) issues.push({ severity: "blocking", code: "MISSING_EVIDENCE", measurement_id: m.measurement_id, missing_evidence_ids: missing });
    if ((m.source_type === "measured" || m.source_type === "documented") && m.canonical_value == null) {
      issues.push({ severity: "blocking", code: "NO_CANONICAL_VALUE", measurement_id: m.measurement_id });
    }
  }
  return { valid: !issues.some((i) => i.severity === "blocking"), issues };
}

export async function render(container) {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    container.innerHTML = emptyState("Select or create a project first.");
    return;
  }
  const project = await getRecord("projects", projectId);
  const [components, measurements, evidence] = await Promise.all([
    getAllByProject("components", projectId),
    getAllByProject("measurements", projectId),
    getAllByProject("evidence", projectId),
  ]);
  const evidenceIds = new Set(evidence.map((e) => e.evidence_id));
  const result = computeValidation(components, measurements, evidenceIds);
  const waiver = project.gate_notes?.data_validated_waiver || "";

  container.innerHTML = `
    <div class="card">
      <h1>Validation</h1>
      ${gateTrack(project.status)}
      <p>${result.valid ? badge("valid", "green") : badge("blocking issues", "red")} · ${result.issues.length} issue(s) found</p>
      ${result.issues.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Severity</th><th>Code</th><th>Detail</th></tr></thead>
          <tbody>
            ${result.issues.map((i) => `
              <tr>
                <td>${badge(i.severity, i.severity === "blocking" ? "red" : "amber")}</td>
                <td class="mono">${esc(i.code)}</td>
                <td>${esc(i.message || "")} ${i.component_id ? `<span class="mono">${esc(i.component_id)}</span>` : ""} ${i.measurement_id ? `<span class="mono">${esc(i.measurement_id)}</span>` : ""} ${i.missing_evidence_ids ? `missing: ${i.missing_evidence_ids.map(esc).join(", ")}` : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>` : emptyState("No issues found.")}
    </div>

    <div class="card">
      <h2>Advance to data_validated</h2>
      <p>If blocking issues remain, record why the gate is being waived -- this stays attached to the project, it does not make the issue disappear.</p>
      <div class="field">
        <label for="waiver-note">Waiver note (required if issues are blocking)</label>
        <textarea id="waiver-note">${esc(waiver)}</textarea>
      </div>
      <div class="btn-row">
        <button id="advance-validated" class="primary" ${project.status !== "capture_complete" ? "disabled" : ""}>Mark data_validated →</button>
      </div>
      ${project.status !== "capture_complete" ? `<p><em>Project must be at capture_complete first.</em></p>` : ""}
    </div>`;

  container.querySelector("#advance-validated")?.addEventListener("click", async () => {
    const note = container.querySelector("#waiver-note").value.trim();
    if (!result.valid && !note) return toast("Blocking issues exist -- add a waiver note or resolve them first", { error: true });
    try {
      const updated = await advanceGate(project, "data_validated");
      updated.gate_notes = { ...(updated.gate_notes || {}), data_validated_waiver: note };
      await putRecord("projects", updated);
      toast("Project marked data_validated");
      render(container);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}
