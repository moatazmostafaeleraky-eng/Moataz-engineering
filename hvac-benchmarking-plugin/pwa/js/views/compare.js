import { getAllByProject, getRecord, putRecord, enqueueSync } from "../db.js";
import { getCurrentProjectId } from "../state.js";
import { uid } from "../ids.js";
import { esc, option, options, COMPARABILITY_STATES, CONFIDENCE_LEVELS, badge, gateTrack, emptyState } from "../ui.js";
import { advanceGate } from "../gates.js";
import { toast } from "../toast.js";

// Mirrors compare_products() in app.py: latest *accepted* measurement per
// product/parameter, same canonical unit required, same delta formulas.
function findLatestAccepted(measurements, components, productId, parameter) {
  const componentIds = new Set(components.filter((c) => c.product_id === productId).map((c) => c.component_id));
  return measurements
    .filter((m) => componentIds.has(m.component_id) && m.parameter === parameter && m.status === "accepted")
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))[0] || null;
}

function computeComparison(measurements, components, parameter, ourId, compId) {
  const ours = findLatestAccepted(measurements, components, ourId, parameter);
  const comp = findLatestAccepted(measurements, components, compId, parameter);
  if (!ours || !comp) return { comparability: "not_comparable", reason: "accepted measurements for both products are required" };
  if (ours.canonical_unit !== comp.canonical_unit) return { comparability: "not_comparable", reason: "canonical units differ" };
  const delta = comp.canonical_value - ours.canonical_value;
  const pct = ours.canonical_value ? (delta / ours.canonical_value) * 100 : null;
  return {
    comparability: "comparable", ours, comp,
    our_value: ours.canonical_value, competitor_value: comp.canonical_value, unit: ours.canonical_unit,
    absolute_delta: delta, percentage_delta: pct, formula: "(competitor - our) / our * 100",
    evidence_ids: [...(ours.evidence_ids || []), ...(comp.evidence_ids || [])],
  };
}

export async function render(container) {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    container.innerHTML = emptyState("Select or create a project first.");
    return;
  }
  const project = await getRecord("projects", projectId);
  const [components, measurements, observations] = await Promise.all([
    getAllByProject("components", projectId),
    getAllByProject("measurements", projectId),
    getAllByProject("observations", projectId),
  ]);
  const ourProducts = project.products.filter((p) => p.owner_type === "our_product");
  const competitorProducts = project.products.filter((p) => p.owner_type === "competitor");
  const confirmed = observations.filter((o) => (o.subject_id || "").startsWith("CMP:")).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  container.innerHTML = `
    <div class="card">
      <h1>Compare products</h1>
      ${gateTrack(project.status)}
      <p>Compares the latest <strong>accepted</strong> measurement for the same parameter on each product. A delta is only calculated when both exist and share a canonical unit, per the skill's comparison formulas.</p>
      <form id="compare-form" class="row">
        <div class="field">
          <label for="cmp-parameter">Parameter</label>
          <input id="cmp-parameter" required placeholder="motor_cost">
        </div>
        <div class="field">
          <label for="cmp-our">Our product</label>
          <select id="cmp-our">${ourProducts.map((p) => option(p.product_id)).join("") || "<option>none registered</option>"}</select>
        </div>
        <div class="field">
          <label for="cmp-competitor">Competitor product</label>
          <select id="cmp-competitor">${competitorProducts.map((p) => option(p.product_id)).join("") || "<option>none registered</option>"}</select>
        </div>
        <div class="field" style="flex:0 0 auto; align-self:flex-end;">
          <button type="submit" class="primary">Compare</button>
        </div>
      </form>
      <div id="compare-result"></div>
    </div>

    <div class="card">
      <h2>Confirmed comparisons</h2>
      ${confirmed.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Subject</th><th>Confirmed state</th><th>Confidence</th><th>Note</th></tr></thead>
          <tbody>
            ${confirmed.map((o) => `<tr><td class="mono">${esc(o.subject_id)}</td><td>${esc((o.text || "").split("|")[0])}</td><td>${esc(o.confidence)}</td><td>${esc((o.text || "").split("|")[1] || "")}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>` : emptyState("No comparisons confirmed yet.")}
      <div class="btn-row">
        <button id="advance-comparison" class="primary" ${project.status !== "data_validated" || !confirmed.length ? "disabled" : ""}>Mark comparison_ready →</button>
      </div>
      ${project.status !== "data_validated" ? "<p><em>Project must be at data_validated first.</em></p>" : !confirmed.length ? "<p><em>Confirm at least one comparison first.</em></p>" : ""}
    </div>`;

  const resultEl = container.querySelector("#compare-result");

  container.querySelector("#compare-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const parameter = container.querySelector("#cmp-parameter").value.trim();
    const ourId = container.querySelector("#cmp-our").value;
    const compId = container.querySelector("#cmp-competitor").value;
    if (!parameter || !ourId || !compId) return toast("Pick a parameter and both products", { error: true });
    if (ourId === compId) return toast("Our product and competitor must differ", { error: true });
    const result = computeComparison(measurements, components, parameter, ourId, compId);

    if (result.comparability === "not_comparable") {
      resultEl.innerHTML = `<div class="card">${badge("not_comparable", "red")} <p>${esc(result.reason)}</p></div>`;
      return;
    }

    resultEl.innerHTML = `
      <div class="card">
        <h3>Fact</h3>
        <p>Our value: <strong class="mono">${result.our_value.toPrecision(6)} ${esc(result.unit)}</strong> · Competitor value: <strong class="mono">${result.competitor_value.toPrecision(6)} ${esc(result.unit)}</strong></p>
        <h3>Calculation</h3>
        <p class="mono">absolute_delta = ${result.absolute_delta.toPrecision(6)} ${esc(result.unit)}; percentage_delta = ${result.percentage_delta != null ? result.percentage_delta.toFixed(2) + "%" : "n/a"}; formula: ${esc(result.formula)}</p>
        <p>Mechanical check: ${badge("comparable (units match)", "amber")} — this is <em>not</em> an engineering confirmation. Per the skill's output-format rule, state the comparability level explicitly before this feeds a report.</p>
        <h3>Engineering confirmation</h3>
        <form id="confirm-form" class="stack">
          <div class="row">
            <div class="field">
              <label for="cmp-state">Comparability state</label>
              <select id="cmp-state">${options(COMPARABILITY_STATES, "conditionally_comparable")}</select>
            </div>
            <div class="field">
              <label for="cmp-confidence">Confidence</label>
              <select id="cmp-confidence">${options(CONFIDENCE_LEVELS, "medium")}</select>
            </div>
          </div>
          <div class="field">
            <label for="cmp-note">Assumptions / required follow-up before this is used in a recommendation</label>
            <textarea id="cmp-note" placeholder="e.g. holds for purchased-cost only; motor operating point, airflow, noise, and reliability not yet evaluated"></textarea>
          </div>
          <div class="btn-row"><button type="submit" class="primary">Confirm comparison</button></div>
        </form>
      </div>`;

    resultEl.querySelector("#confirm-form").addEventListener("submit", async (ev2) => {
      ev2.preventDefault();
      const state = resultEl.querySelector("#cmp-state").value;
      const confidence = resultEl.querySelector("#cmp-confidence").value;
      const note = resultEl.querySelector("#cmp-note").value.trim();
      const observationId = uid("OBS");
      const payload = {
        project_id: projectId,
        observation_id: observationId,
        subject_id: `CMP:${ourId}:${compId}:${parameter}`,
        text: `${state}|${note}`,
        source_type: "calculated",
        evidence_ids: result.evidence_ids,
        confidence,
      };
      await putRecord("observations", { ...payload, status: "pending_review", created_at: new Date().toISOString(), _sync_status: "pending" });
      await enqueueSync({ endpoint: "recordObservation", payload, mirrorStore: "observations", mirrorKeyField: "observation_id", localKey: observationId });
      toast("Comparison confirmed and queued to sync");
      render(container);
    });
  });

  container.querySelector("#advance-comparison")?.addEventListener("click", async () => {
    try {
      await advanceGate(project, "comparison_ready");
      toast("Project marked comparison_ready");
      render(container);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
}
