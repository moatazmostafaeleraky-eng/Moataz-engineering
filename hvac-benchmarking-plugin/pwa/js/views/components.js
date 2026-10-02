import { getAllByProject, putRecord, enqueueSync, getRecord } from "../db.js";
import { getCurrentProjectId } from "../state.js";
import { uid } from "../ids.js";
import { unitsFor } from "../units.js";
import { assemblySuggestions } from "../hvac-coverage.js";
import { esc, options, option, EVIDENCE_STATES, CONFIDENCE_LEVELS, RECORD_STATUSES, evidenceStateBadge, confidenceBadge, statusBadge, pendingReviewFlag, emptyState } from "../ui.js";
import { toast } from "../toast.js";

export async function render(container) {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    container.innerHTML = emptyState("Select or create a project first.");
    return;
  }
  const project = await getRecord("projects", projectId);
  const components = (await getAllByProject("components", projectId)).sort((a, b) => (a.product_id || "").localeCompare(b.product_id || "") || (a.assembly || "").localeCompare(b.assembly || ""));
  const massUnits = unitsFor("mass");
  const suggestions = assemblySuggestions(project.scope);

  container.innerHTML = `
    <div class="card">
      <h1>Components</h1>
      <p>Register every assembly/component with a stable ID, function, and evidence state. Leave weight blank rather than guessing -- an unknown value stays <code>unknown</code> until it is weighed or documented.</p>
      <div class="table-wrap">
        ${components.length ? `
        <table>
          <thead><tr><th>Product</th><th>Assembly</th><th>Name</th><th>Function</th><th>Qty</th><th>Weight</th><th>Evidence</th><th>Confidence</th><th>Status</th></tr></thead>
          <tbody>
            ${components.map((c) => `
              <tr>
                <td class="mono">${esc(c.product_id)}</td>
                <td>${esc(c.assembly || "")}</td>
                <td>${esc(c.name)} ${pendingReviewFlag(c)}</td>
                <td>${esc(c.function)}</td>
                <td>${esc(c.quantity ?? 1)}</td>
                <td class="value-cell">${c.weight_value != null ? `${c.weight_value} ${esc(c.weight_unit || "")}` : "—"}</td>
                <td>${evidenceStateBadge(c.evidence_state)}</td>
                <td>${confidenceBadge(c.confidence)}</td>
                <td>${statusBadge(c.status)}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : emptyState("No components registered yet.")}
      </div>
    </div>

    <div class="card">
      <h2>Register component</h2>
      <form id="component-form" class="stack">
        <datalist id="assembly-suggestions">${suggestions.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
        <div class="row">
          <div class="field">
            <label for="c-product">Product</label>
            <select id="c-product" name="product_id">${(project.products || []).map((p) => option(p.product_id)).join("")}</select>
          </div>
          <div class="field">
            <label for="c-assembly">Assembly</label>
            <input id="c-assembly" name="assembly" list="assembly-suggestions" placeholder="e.g. outdoor unit">
          </div>
          <div class="field">
            <label for="c-parent">Parent component (optional)</label>
            <select id="c-parent" name="parent_component_id"><option value="">— none —</option>
              ${components.map((c) => `<option value="${esc(c.component_id)}">${esc(c.component_id)} – ${esc(c.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="c-name">Name</label>
            <input id="c-name" name="name" list="assembly-suggestions" required placeholder="axial fan and motor">
          </div>
          <div class="field">
            <label for="c-function">Function</label>
            <input id="c-function" name="function" required placeholder="condenser airflow">
          </div>
          <div class="field">
            <label for="c-qty">Quantity</label>
            <input id="c-qty" name="quantity" type="number" min="0" step="1" value="1">
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="c-weight-value">Weight (optional)</label>
            <input id="c-weight-value" name="weight_value" type="number" step="any" inputmode="decimal">
          </div>
          <div class="field">
            <label for="c-weight-unit">Weight unit</label>
            <select id="c-weight-unit" name="weight_unit">${options(massUnits)}</select>
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="c-evidence-state">Evidence state</label>
            <select id="c-evidence-state" name="evidence_state">${options(EVIDENCE_STATES, "unknown")}</select>
          </div>
          <div class="field">
            <label for="c-confidence">Confidence</label>
            <select id="c-confidence" name="confidence">${options(CONFIDENCE_LEVELS, "unresolved")}</select>
          </div>
          <div class="field">
            <label for="c-status">Status</label>
            <select id="c-status" name="status">${options(RECORD_STATUSES, "pending_review")}</select>
          </div>
        </div>
        <div class="field">
          <label for="c-notes">Notes (condition, material/process observation, interfaces)</label>
          <textarea id="c-notes" name="notes" placeholder="Note visual-only material guesses as inferred, e.g. 'likely polymer housing, unconfirmed'."></textarea>
        </div>
        <div class="btn-row"><button type="submit" class="primary">Save component</button></div>
      </form>
    </div>`;

  container.querySelector("#component-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const name = form.name.value.trim();
    const fn = form.function.value.trim();
    if (!name || !fn) return toast("Name and function are required", { error: true });

    const componentId = uid("CMP");
    const payload = {
      project_id: projectId,
      component_id: componentId,
      product_id: form.product_id.value,
      assembly: form.assembly.value.trim() || null,
      parent_component_id: form.parent_component_id.value || null,
      name,
      function: fn,
      quantity: Number(form.quantity.value || 1),
      weight: form.weight_value.value ? { value: Number(form.weight_value.value), unit: form.weight_unit.value } : null,
      evidence_state: form.evidence_state.value,
      confidence: form.confidence.value,
      status: form.status.value,
      notes: form.notes.value.trim() || null,
    };
    const record = {
      ...payload,
      weight_value: payload.weight ? payload.weight.value : null,
      weight_unit: payload.weight ? payload.weight.unit : null,
      _sync_status: "pending",
      created_at: new Date().toISOString(),
    };
    await putRecord("components", record);
    await enqueueSync({ endpoint: "registerComponent", payload, mirrorStore: "components", mirrorKeyField: "component_id", localKey: componentId });
    toast(`Component ${componentId} saved (queued to sync)`);
    render(container);
  });
}
