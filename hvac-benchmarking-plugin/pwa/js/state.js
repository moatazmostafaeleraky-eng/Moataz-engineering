import { getMeta, setMeta, getRecord } from "./db.js";

let currentProjectId = null;
const listeners = new Set();

export async function loadCurrentProject() {
  currentProjectId = await getMeta("current_project_id", null);
  return currentProjectId;
}

export async function setCurrentProject(projectId) {
  currentProjectId = projectId;
  await setMeta("current_project_id", projectId);
  for (const fn of listeners) fn(projectId);
}

export function getCurrentProjectId() {
  return currentProjectId;
}

export async function getCurrentProject() {
  if (!currentProjectId) return null;
  return getRecord("projects", currentProjectId);
}

export function onProjectChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
