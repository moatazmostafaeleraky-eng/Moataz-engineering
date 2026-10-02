// Review-gate transitions (hvac-benchmarking-skill "Required review gates").
// Advancing a gate is always an explicit engineer action from the UI -- never
// inferred automatically from data completeness alone -- even though each
// view computes whether the gate's prerequisites look satisfied.

import { putRecord, enqueueSync } from "./db.js";
import { PROJECT_STATUSES } from "./ui.js";

export async function advanceGate(project, nextStatus) {
  const curIdx = PROJECT_STATUSES.indexOf(project.status || "draft");
  const nextIdx = PROJECT_STATUSES.indexOf(nextStatus);
  if (nextIdx < 0) throw new Error(`Unknown gate: ${nextStatus}`);
  if (nextIdx < curIdx) throw new Error("Cannot move a gate backward");
  const updated = { ...project, status: nextStatus, _sync_status: "pending" };
  await putRecord("projects", updated);
  await enqueueSync({
    endpoint: "updateProjectStatus",
    payload: { project_id: project.project_id, status: nextStatus },
    mirrorStore: "projects",
    mirrorKeyField: "project_id",
    localKey: project.project_id,
  });
  return updated;
}
