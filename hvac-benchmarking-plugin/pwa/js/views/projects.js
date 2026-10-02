import { getAll, putRecord, enqueueSync } from "../db.js";
import { uid } from "../ids.js";
import { setCurrentProject, getCurrentProjectId } from "../state.js";
import { esc, gateTrack, emptyState, syncBadge } from "../ui.js";
import { toast } from "../toast.js";
import { navigate } from "../router.js";

const SCOPES = ["indoor", "outdoor", "performance", "cost"];

let productRows = 2;

function productRowHtml(i) {
  return `
    <div class="row product-row" data-row="${i}">
      <div class="field">
        <label for="prod-id-${i}">Product ID</label>
        <input id="prod-id-${i}" name="product_id" placeholder="OUR / COMP-A" required>
      </div>
      <div class="field">
        <label for="prod-owner-${i}">Owner</label>
        <select id="prod-owner-${i}" name="owner_type">
          <option value="our_product">our_product</option>
          <option value="competitor">competitor</option>
        </select>
      </div>
      <div class="field">
        <label for="prod-model-${i}">Model</label>
        <input id="prod-model-${i}" name="model" placeholder="e.g. INV-24">
      </div>
      <div class="field">
        <label for="prod-cat-${i}">Category</label>
        <input id="prod-cat-${i}" name="category" placeholder="split / window / vrf">
      </div>
    </div>`;
}

export async function render(container) {
  const projects = (await getAll("projects")).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  container.innerHTML = `
    <div class="card">
      <h1>Benchmark projects</h1>
      <p>Create a benchmark to compare our product against one or more competitor units. A project always needs at least two products and at least one scope area, per the teardown benchmarking workflow.</p>
      <div class="table-wrap">
        ${projects.length ? `
        <table>
          <thead><tr><th>Title</th><th>Scope</th><th>Status</th><th>Products</th><th></th></tr></thead>
          <tbody>
            ${projects.map((p) => `
              <tr>
                <td>${esc(p.title)} ${syncBadge(p)}</td>
                <td>${(p.scope || []).map(esc).join(", ")}</td>
                <td>${esc(p.status)}</td>
                <td class="mono">${(p.products || []).map((pr) => esc(pr.product_id)).join(", ")}</td>
                <td><button type="button" class="ghost" data-open="${esc(p.project_id)}">Open →</button></td>
              </tr>`).join("")}
          </tbody>
        </table>` : emptyState("No benchmark projects yet. Create one below.")}
      </div>
    </div>

    <div class="card">
      <h2>New benchmark project</h2>
      <form id="project-form" class="stack">
        <div class="field">
          <label for="title">Title</label>
          <input id="title" name="title" required placeholder="Outdoor motor benchmark">
        </div>
        <fieldset>
          <legend>Scope</legend>
          ${SCOPES.map((s) => `
            <label class="check-row"><input type="checkbox" name="scope" value="${s}"> ${s}</label>`).join("")}
        </fieldset>
        <fieldset id="products-fieldset">
          <legend>Products (minimum 2)</legend>
          <div id="product-rows">${productRowHtml(0)}${productRowHtml(1)}</div>
          <button type="button" id="add-product" class="ghost">+ add product</button>
        </fieldset>
        <div class="btn-row">
          <button type="submit" class="primary">Create project</button>
        </div>
      </form>
    </div>`;

  container.querySelectorAll("[data-open]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await setCurrentProject(btn.dataset.open);
      navigate("checklist");
    });
  });

  const rowsEl = container.querySelector("#product-rows");
  container.querySelector("#add-product").addEventListener("click", () => {
    rowsEl.insertAdjacentHTML("beforeend", productRowHtml(productRows++));
  });

  container.querySelector("#project-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const title = form.title.value.trim();
    const scope = Array.from(form.querySelectorAll('input[name="scope"]:checked')).map((el) => el.value);
    const productEls = Array.from(form.querySelectorAll(".product-row"));
    const products = productEls.map((row) => ({
      product_id: row.querySelector('[name="product_id"]').value.trim(),
      owner_type: row.querySelector('[name="owner_type"]').value,
      model: row.querySelector('[name="model"]').value.trim(),
      category: row.querySelector('[name="category"]').value.trim(),
    })).filter((p) => p.product_id);

    if (!title) return toast("Title is required", { error: true });
    if (!scope.length) return toast("Pick at least one scope area", { error: true });
    if (products.length < 2) return toast("At least two products are required", { error: true });
    const ids = new Set(products.map((p) => p.product_id));
    if (ids.size !== products.length) return toast("Product IDs must be unique", { error: true });

    const project = {
      project_id: uid("BM"),
      title,
      revision: 1,
      scope,
      products,
      status: "draft",
      owner: null,
      created_at: new Date().toISOString(),
      _sync_status: "pending",
    };
    await putRecord("projects", project);
    await enqueueSync({
      endpoint: "createProject",
      payload: { project_id: project.project_id, title, scope, products },
      mirrorStore: "projects",
      mirrorKeyField: "project_id",
      localKey: project.project_id,
    });
    await setCurrentProject(project.project_id);
    toast(`Project ${project.project_id} created (queued to sync)`);
    navigate("checklist");
  });
}
