import { getCurrentProjectId } from "../state.js";
import { emptyState, esc } from "../ui.js";

// Pure math, mirrors calculate_kpis() in app.py exactly -- no network or
// storage needed, so this works identically on- or offline.
function calculate({ performance, mass, input_power, component_cost, total_cost }) {
  const calculated = {};
  if (performance != null && mass) calculated.performance_per_mass = performance / mass;
  if (performance != null && input_power) calculated.performance_per_power = performance / input_power;
  if (component_cost != null && total_cost) calculated.cost_share_pct = (component_cost / total_cost) * 100;
  return calculated;
}

export async function render(container) {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    container.innerHTML = emptyState("Select or create a project first.");
    return;
  }

  container.innerHTML = `
    <div class="card">
      <h1>KPIs</h1>
      <p>Enter canonical SI values (performance in W, mass in kg, input power in W, costs in project currency). All results are <code>calculated</code> -- treat as derived figures, not independently measured facts.</p>
      <form id="kpi-form" class="row">
        <div class="field"><label for="k-performance">Performance (W)</label><input id="k-performance" type="number" step="any"></div>
        <div class="field"><label for="k-mass">Mass (kg)</label><input id="k-mass" type="number" step="any"></div>
        <div class="field"><label for="k-power">Input power (W)</label><input id="k-power" type="number" step="any"></div>
        <div class="field"><label for="k-component-cost">Component cost</label><input id="k-component-cost" type="number" step="any"></div>
        <div class="field"><label for="k-total-cost">Total cost</label><input id="k-total-cost" type="number" step="any"></div>
      </form>
      <div id="kpi-result" class="mono"></div>
    </div>`;

  const resultEl = container.querySelector("#kpi-result");
  const recalc = () => {
    const values = {
      performance: container.querySelector("#k-performance").value ? Number(container.querySelector("#k-performance").value) : null,
      mass: container.querySelector("#k-mass").value ? Number(container.querySelector("#k-mass").value) : null,
      input_power: container.querySelector("#k-power").value ? Number(container.querySelector("#k-power").value) : null,
      component_cost: container.querySelector("#k-component-cost").value ? Number(container.querySelector("#k-component-cost").value) : null,
      total_cost: container.querySelector("#k-total-cost").value ? Number(container.querySelector("#k-total-cost").value) : null,
    };
    const calculated = calculate(values);
    const entries = Object.entries(calculated);
    resultEl.innerHTML = entries.length
      ? entries.map(([k, v]) => `<p>${esc(k)} = ${Number(v).toPrecision(6)}</p>`).join("")
      : `<p>Enter enough values to calculate a KPI.</p>`;
  };
  container.querySelector("#kpi-form").addEventListener("input", recalc);
  recalc();
}
