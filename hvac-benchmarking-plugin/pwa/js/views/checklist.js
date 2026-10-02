import { getAllByProject, putRecord, enqueueSync, getRecord } from "../db.js";
import { getCurrentProjectId } from "../state.js";
import { buildChecklistItems } from "../checklist-library.js";
import { uid } from "../ids.js";
import { gateTrack, esc, emptyState } from "../ui.js";
import { advanceGate } from "../gates.js";
import { toast } from "../toast.js";
import { navigate } from "../router.js";

export async function render(container) {
  const projectId = getCurrentProjectId();
  if (!projectId) {
    container.innerHTML = emptyState("Select or create a project first.");
    return;
  }
  const project = await getRecord("projects", projectId);
  const checklists = (await getAllByProject("checklists", projectId)).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const checklist = checklists[0] || null;

  container.innerHTML = `
    <div class="card">
      <h1>${esc(project.title)}</h1>
      ${gateTrack(project.status)}
      <p>Teardown checklist for scope: <strong>${(project.scope || []).map(esc).join(", ")}</strong>. Generated from the standard HVAC base items plus the item library for each scope area, per the benchmarking skill's step 1.</p>
      ${checklist ? "" : `<button id="gen-checklist" class="primary">Generate teardown checklist</button>`}
    </div>
    ${checklist ? `
    <div class="card">
      <h2>Checklist <span class="mono">${esc(checklist.checklist_id)}</span></h2>
      <p id="progress-label"></p>
      <div class="stack" id="checklist-items">
        ${checklist.items.map((item, i) => `
          <label class="check-row">
            <input type="checkbox" data-idx="${i}" ${checklist.checked_items?.includes(item) ? "checked" : ""}>
            ${esc(item)}
          </label>`).join("")}
      </div>
      <div class="btn-row">
        <button id="advance-capture" class="primary">Mark capture complete →</button>
        <button id="go-components" class="ghost">Go to components →</button>
      </div>
    </div>` : ""}`;

  if (!checklist) {
    container.querySelector("#gen-checklist").addEventListener("click", async () => {
      const items = buildChecklistItems(project.scope);
      const record = {
        checklist_id: uid("CHK"),
        project_id: projectId,
        scope: project.scope,
        items,
        checked_items: [],
        created_at: new Date().toISOString(),
        _sync_status: "pending",
      };
      await putRecord("checklists", record);
      await enqueueSync({ endpoint: "generateChecklist", payload: { project_id: projectId, scope: project.scope } });
      toast("Checklist generated");
      render(container);
    });
    return;
  }

  const updateProgress = () => {
    const total = checklist.items.length;
    const done = (checklist.checked_items || []).length;
    container.querySelector("#progress-label").textContent = `${done} / ${total} items captured`;
    container.querySelector("#advance-capture").disabled = done < total || project.status !== "draft";
  };
  updateProgress();

  container.querySelectorAll("#checklist-items input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", async () => {
      const item = checklist.items[Number(cb.dataset.idx)];
      const set = new Set(checklist.checked_items || []);
      if (cb.checked) set.add(item); else set.delete(item);
      checklist.checked_items = Array.from(set);
      await putRecord("checklists", checklist);
      updateProgress();
    });
  });

  container.querySelector("#advance-capture").addEventListener("click", async () => {
    try {
      await advanceGate(project, "capture_complete");
      toast("Project marked capture_complete");
      render(container);
    } catch (err) {
      toast(err.message, { error: true });
    }
  });

  container.querySelector("#go-components").addEventListener("click", () => navigate("components"));
}
