// Thin fetch wrapper around the hvac-benchmarking-plugin Flask API. Every
// function here maps 1:1 onto a backend route; the sync engine replays queued
// writes through these, and views call them directly for read-only lookups
// when the app is online.

const BASE = ""; // same origin: Flask serves the PWA and the API together

async function request(method, path, { json, form, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const init = { method, signal: controller.signal };
    if (json !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(json);
    } else if (form !== undefined) {
      init.body = form;
    }
    const res = await fetch(BASE + path, init);
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = new Error(data.error || `${method} ${path} failed (${res.status})`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkOnline() {
  try {
    await request("GET", "/health", { timeoutMs: 4000 });
    return true;
  } catch {
    return false;
  }
}

export const api = {
  createProject: (payload) => request("POST", "/tools/create_benchmark_project", { json: payload }),
  updateProjectStatus: (payload) => request("POST", "/tools/update_project_status", { json: payload }),
  generateChecklist: (payload) => request("POST", "/tools/generate_teardown_checklist", { json: payload }),
  registerComponent: (payload) => request("POST", "/tools/register_component", { json: payload }),
  uploadEvidence: (payload) => request("POST", "/tools/upload_evidence", { json: payload }),
  uploadEvidenceFile: (formData) => request("POST", "/tools/upload_evidence_file", { form: formData }),
  recordMeasurement: (payload) => request("POST", "/tools/record_measurement", { json: payload }),
  recordObservation: (payload) => request("POST", "/tools/record_observation", { json: payload }),
  validateProject: (payload) => request("POST", "/tools/validate_project", { json: payload }),
  generateBom: (payload) => request("POST", "/tools/generate_bom", { json: payload }),
  compareProducts: (payload) => request("POST", "/tools/compare_products", { json: payload }),
  calculateKpis: (payload) => request("POST", "/tools/calculate_kpis", { json: payload }),
  generateReport: (payload) => request("POST", "/tools/generate_report", { json: payload }),
  getProject: (projectId) => request("GET", `/projects/${projectId}`),
};

// Maps a sync_queue entry's { endpoint, payload } back onto an api.* call.
export function callByEndpoint(endpoint, payload) {
  if (!(endpoint in api)) throw new Error(`Unknown sync endpoint: ${endpoint}`);
  return api[endpoint](payload);
}
