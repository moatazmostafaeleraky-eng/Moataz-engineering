import { getAllByProject } from "../db.js";
import { getCurrentProjectId } from "../state.js";
import { esc, evidenceStateBadge, pendingReviewFlag, emptyState } from "../ui.js";

function toCsv(rows) {
  const headers = ["product_id", "assembly", "component_id", "name", "function", "quantity", "weight_value", "weight_unit", "evidence_state", "confidence", "status"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

export async function render(container) {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    container.innerHTML = emptyState("Select or create a project first.");
    return;
  }
  const items = (await getAllByProject("components", projectId))
    .sort((a, b) => (a.product_id || "").localeCompare(b.product_id || "") || (a.assembly || "").localeCompare(b.assembly || "") || (a.component_id || "").localeCompare(b.component_id || ""));

  container.innerHTML = `
    <div class="card">
      <h1>Bill of materials</h1>
      <p>${items.length} component record(s), ordered by product then assembly -- matches <code>generate_bom</code>.</p>
      <div class="btn-row">
        <button id="export-csv" ${items.length ? "" : "disabled"}>Export CSV</button>
      </div>
      <div class="table-wrap">
        ${items.length ? `
        <table>
          <thead><tr><th>Product</th><th>Assembly</th><th>Component ID</th><th>Name</th><th>Qty</th><th>Weight</th><th>Evidence</th></tr></thead>
          <tbody>
            ${items.map((c) => `
              <tr>
                <td class="mono">${esc(c.product_id)}</td>
                <td>${esc(c.assembly || "")}</td>
                <td class="mono">${esc(c.component_id)}</td>
                <td>${esc(c.name)} ${pendingReviewFlag(c)}</td>
                <td>${esc(c.quantity ?? 1)}</td>
                <td class="value-cell">${c.weight_value != null ? `${c.weight_value} ${esc(c.weight_unit || "")}` : "—"}</td>
                <td>${evidenceStateBadge(c.evidence_state)}</td>
              </tr>`).join("")}
          </tbody>
        </table>` : emptyState("No components registered yet.")}
      </div>
    </div>`;

  container.querySelector("#export-csv")?.addEventListener("click", () => {
    const blob = new Blob([toCsv(items)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectId}-bom.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}
