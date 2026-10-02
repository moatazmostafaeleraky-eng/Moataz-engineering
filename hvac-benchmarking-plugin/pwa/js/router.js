export const ROUTES = [
  { id: "projects", label: "Projects", requiresProject: false },
  { id: "checklist", label: "Checklist", requiresProject: true },
  { id: "components", label: "Components", requiresProject: true },
  { id: "evidence", label: "Evidence", requiresProject: true },
  { id: "measurements", label: "Measurements", requiresProject: true },
  { id: "validation", label: "Validate", requiresProject: true },
  { id: "bom", label: "BOM", requiresProject: true },
  { id: "compare", label: "Compare", requiresProject: true },
  { id: "kpis", label: "KPIs", requiresProject: true },
  { id: "report", label: "Report", requiresProject: true },
];

export function currentRoute() {
  const id = (location.hash || "#/projects").replace(/^#\/?/, "") || "projects";
  return ROUTES.find((r) => r.id === id) ? id : "projects";
}

export function navigate(id) {
  location.hash = `#/${id}`;
}

export function onRouteChange(fn) {
  window.addEventListener("hashchange", fn);
}
