import { getAllByProject, putRecord, enqueueSync } from "../db.js";
import { getCurrentProjectId } from "../state.js";
import { uid } from "../ids.js";
import { unitsFor, dimensionFor, toCanonical } from "../units.js";
import { esc, option, options, SOURCE_TYPES, RECORD_STATUSES, statusBadge, pendingReviewFlag, emptyState } from "../ui.js";
import { toast } from "../toast.js";

const PARAMETER_SUGGESTIONS = [
  "mass", "length", "width", "height", "depth", "diameter", "thickness",
  "temperature", "pressure", "input_power", "cooling_capacity", "heating_capacity",
  "airflow", "noise", "motor_cost", "component_cost", "total_cost",
];

export async function render(container) {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    container.innerHTML = emptyState("Select or create a project first.");
    return;
  }
  const [components, evidence, measurements] = await Promise.all([
    getAllByProject("components", projectId),
    getAllByProject("evidence", projectId),
    getAllByProject("measurements", projectId),
  ]);
  measurements.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const componentName = (id) => components.find((c) => c.component_id === id)?.name || id;

  if (!components.length) {
    container.innerHTML = emptyState("Register at least one component before recording measurements.");
    return;
  }

  container.innerHTML = `
    <div class="card">
      <h1>Measurements</h1>
      <p>Raw value and unit are kept exactly as entered; the canonical SI value is calculated and stored alongside it, never in place of it, per the skill's unit rules.</p>
      <div class="table-wrap">
        ${measurements.length ? `
        <table>
          <thead><tr><th>Component</th><th>Parameter</th><th>Raw</th><th>Canonical</th><th>Source</th><th>Uncertainty</th><th>Status</th></tr></thead>
          <tbody>
            ${measurements.map((m) => `
              <tr>
                <td>${esc(componentName(m.component_id))}</td>
                <td>${esc(m.parameter)} ${pendingReviewFlag(m)}</td>
                <td class="value-cell">${esc(m.raw_value)} ${esc(m.raw_unit)}</td>
                <td class="value-cell">${m.canonical_value != null ? `${Number(m.canonical_value).toPrecision(6)} ${esc(m.canonical_unit || "")}` : "—"}</td>
                <td>${esc(m.source_type)}</td>
                <td class="value-cell">${m.uncertainty != null ? esc(m.uncertainty) : "—"}</td>
                <td>${statusBadge(m.status)}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : emptyState("No measurements recorded yet.")}
      </div>
    </div>

    <div class="card">
      <h2>Record measurement</h2>
      <form id="measurement-form" class="stack">
        <datalist id="parameter-suggestions">${PARAMETER_SUGGESTIONS.map((p) => `<option value="${p}">`).join("")}</datalist>
        <div class="row">
          <div class="field">
            <label for="m-component">Component</label>
            <select id="m-component" name="component_id">
              ${components.map((c) => `<option value="${esc(c.component_id)}">${esc(c.component_id)} – ${esc(c.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="m-parameter">Parameter</label>
            <input id="m-parameter" name="parameter" list="parameter-suggestions" required placeholder="motor_cost">
          </div>
        </div>
        <div class="row">
          <div class="field">
            <label for="m-raw-value">Raw value</label>
            <input id="m-raw-value" name="raw_value" type="number" step="any" required>
          </div>
          <div class="field">
            <label for="m-raw-unit">Raw unit</label>
            <input id="m-raw-unit" name="raw_unit" required list="unit-suggestions" placeholder="USD, mm, degC...">
            <datalist id="unit-suggestions"></datalist>
          </div>
          <div class="field">
            <label for="m-uncertainty">Uncertainty (±, optional)</label>
            <input id="m-uncertainty" name="uncertainty" type="number" step="any">
          </div>
        </div>
        <p id="canonical-preview" class="mono"></p>
        <fieldset id="manual-canonical" hidden>
          <legend>Manual canonical value (no automatic conversion found)</legend>
          <div class="row">
            <div class="field"><label for="m-canon-value">Canonical value</label><input id="m-canon-value" name="canonical_value" type="number" step="any"></div>
            <div class="field"><label for="m-canon-unit">Canonical unit</label><input id="m-canon-unit" name="canonical_unit"></div>
          </div>
        </fieldset>
        <div class="row">
          <div class="field">
            <label for="m-source">Source type</label>
            <select id="m-source" name="source_type">${options(SOURCE_TYPES, "measured")}</select>
          </div>
          <div class="field">
            <label for="m-status">Status</label>
            <select id="m-status" name="status">${options(RECORD_STATUSES, "pending_review")}</select>
          </div>
        </div>
        <fieldset>
          <legend>Evidence (at least one required)</legend>
          ${evidence.length ? evidence.map((e) => `
            <label class="check-row"><input type="checkbox" name="evidence_ids" value="${esc(e.evidence_id)}"> ${esc(e.evidence_id)} – ${esc(e.evidence_type)}${e.description ? ` (${esc(e.description)})` : ""}</label>
          `).join("") : `<p>No evidence captured yet — add some on the Evidence tab first.</p>`}
        </fieldset>
        <div class="btn-row"><button type="submit" class="primary" ${evidence.length ? "" : "disabled"}>Save measurement</button></div>
      </form>
    </div>`;

  const form = container.querySelector("#measurement-form");
  const preview = container.querySelector("#canonical-preview");
  const manualFieldset = container.querySelector("#manual-canonical");
  const unitList = container.querySelector("#unit-suggestions");

  const updatePreview = () => {
    const parameter = form.parameter.value.trim();
    const rawUnit = form.raw_unit.value.trim();
    const rawValue = form.raw_value.value;
    unitList.innerHTML = options(unitsFor(parameter));
    if (!parameter || !rawUnit || rawValue === "") {
      preview.textContent = dimensionFor(parameter) ? `Dimension: ${dimensionFor(parameter)}` : "";
      manualFieldset.hidden = true;
      return;
    }
    const result = toCanonical(parameter, rawValue, rawUnit);
    if (result) {
      preview.textContent = `Canonical: ${result.canonical_value.toPrecision(6)} ${result.canonical_unit}  (${result.method})`;
      manualFieldset.hidden = true;
    } else {
      preview.textContent = "No automatic conversion for this parameter/unit -- enter the canonical value manually.";
      manualFieldset.hidden = false;
    }
  };
  form.parameter.addEventListener("input", updatePreview);
  form.raw_unit.addEventListener("input", updatePreview);
  form.raw_value.addEventListener("input", updatePreview);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const parameter = form.parameter.value.trim();
    const rawUnit = form.raw_unit.value.trim();
    const rawValue = Number(form.raw_value.value);
    const evidenceIds = Array.from(form.querySelectorAll('input[name="evidence_ids"]:checked')).map((el) => el.value);
    if (!evidenceIds.length) return toast("Link at least one evidence ID", { error: true });

    const auto = toCanonical(parameter, rawValue, rawUnit);
    const canonicalValue = auto ? auto.canonical_value : (form.canonical_value.value ? Number(form.canonical_value.value) : null);
    const canonicalUnit = auto ? auto.canonical_unit : (form.canonical_unit.value.trim() || null);
    const sourceType = form.source_type.value;
    if ((sourceType === "measured" || sourceType === "documented") && canonicalValue == null) {
      return toast("A canonical value is required for measured/documented values", { error: true });
    }

    const measurementId = uid("MEAS");
    const payload = {
      project_id: projectId,
      measurement_id: measurementId,
      component_id: form.component_id.value,
      parameter,
      raw_value: rawValue,
      raw_unit: rawUnit,
      canonical_value: canonicalValue,
      canonical_unit: canonicalUnit,
      source_type: sourceType,
      evidence_ids: evidenceIds,
      uncertainty: form.uncertainty.value ? Number(form.uncertainty.value) : null,
      status: form.status.value,
    };
    await putRecord("measurements", { ...payload, created_at: new Date().toISOString(), _sync_status: "pending" });
    await enqueueSync({ endpoint: "recordMeasurement", payload, mirrorStore: "measurements", mirrorKeyField: "measurement_id", localKey: measurementId });
    toast(`Measurement ${measurementId} saved (queued to sync)`);
    render(container);
  });
}
