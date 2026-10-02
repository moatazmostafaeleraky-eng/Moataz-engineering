import { ROUTES, currentRoute, navigate, onRouteChange } from "./router.js";
import { loadCurrentProject, getCurrentProjectId, getCurrentProject, onProjectChange } from "./state.js";
import { startAutoSync, onSyncStatus } from "./sync.js";
import { esc } from "./ui.js";

import * as projectsView from "./views/projects.js";
import * as checklistView from "./views/checklist.js";
import * as componentsView from "./views/components.js";
import * as evidenceView from "./views/evidence.js";
import * as measurementsView from "./views/measurements.js";
import * as validationView from "./views/validation.js";
import * as bomView from "./views/bom.js";
import * as compareView from "./views/compare.js";
import * as kpisView from "./views/kpis.js";
import * as reportView from "./views/report.js";

const VIEWS = {
  projects: projectsView,
  checklist: checklistView,
  components: componentsView,
  evidence: evidenceView,
  measurements: measurementsView,
  validation: validationView,
  bom: bomView,
  compare: compareView,
  kpis: kpisView,
  report: reportView,
};

const view = document.getElementById("view");
const navEl = document.getElementById("nav-tabs");
const netBadge = document.getElementById("net-badge");
const projectNameEl = document.getElementById("current-project-name");

function renderNav(activeId, hasProject) {
  navEl.innerHTML = ROUTES.map((r) => `
    <button type="button" data-route="${r.id}" aria-current="${r.id === activeId}" ${r.requiresProject && !hasProject ? "disabled" : ""}>${esc(r.label)}</button>
  `).join("");
  navEl.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => navigate(btn.dataset.route));
  });
}

async function renderCurrentView() {
  const routeId = currentRoute();
  const hasProject = !!getCurrentProjectId();
  renderNav(routeId, hasProject);
  const project = await getCurrentProject();
  projectNameEl.textContent = project ? `— ${project.title}` : "";
  await VIEWS[routeId].render(view);
}

onRouteChange(renderCurrentView);
onProjectChange(renderCurrentView);

onSyncStatus((status) => {
  if (status.type === "connectivity") {
    netBadge.dataset.state = status.online ? "online" : "offline";
    netBadge.textContent = status.online ? "Online" : "Offline — saving locally";
  } else if (status.type === "sync-start") {
    netBadge.dataset.state = "syncing";
    netBadge.textContent = "Syncing…";
  } else if (status.type === "sync-end") {
    netBadge.dataset.state = navigator.onLine ? "online" : "offline";
    netBadge.textContent = navigator.onLine ? "Online" : "Offline — saving locally";
    renderCurrentView();
  }
});

async function main() {
  await loadCurrentProject();
  await renderCurrentView();
  startAutoSync();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("service worker registration failed", err));
  }
}

main();
