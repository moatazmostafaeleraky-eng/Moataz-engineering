// Shared render helpers + the controlled vocabularies straight from the
// hvac-benchmarking-skill ("Evidence-state vocabulary", "Confidence levels",
// review gates). Keeping these as single source-of-truth arrays means every
// dropdown in the app offers exactly the skill's terms -- never a free-text
// field standing in for them.

export const PROJECT_STATUSES = [
  "draft",
  "capture_complete",
  "data_validated",
  "comparison_ready",
  "decision_reviewed",
  "released",
];

export const EVIDENCE_STATES = ["measured", "observed", "documented", "calculated", "inferred", "unknown", "conflicting"];
export const SOURCE_TYPES = ["measured", "observed", "documented", "calculated", "inferred"];
export const CONFIDENCE_LEVELS = ["high", "medium", "low", "unresolved"];
export const RECORD_STATUSES = ["pending_review", "accepted", "rejected"];
export const EVIDENCE_TYPES = ["photo", "label", "document", "test_file", "benchmark_slide"];
export const COMPARABILITY_STATES = ["comparable", "conditionally_comparable", "directional_only", "not_comparable"];

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function option(value, selected) {
  return `<option value="${esc(value)}" ${selected === value ? "selected" : ""}>${esc(value)}</option>`;
}

export function options(list, selected) {
  return list.map((v) => option(v, selected)).join("");
}

const EVIDENCE_BADGE = { measured: "green", documented: "green", observed: "amber", calculated: "neutral", inferred: "amber", unknown: "red", conflicting: "red" };
const CONFIDENCE_BADGE = { high: "green", medium: "amber", low: "red", unresolved: "red" };
const STATUS_BADGE = { accepted: "green", pending_review: "amber", rejected: "red" };

export function badge(text, kind) {
  return `<span class="badge badge-${kind || "neutral"}">${esc(text)}</span>`;
}

export function evidenceStateBadge(state) {
  return badge(state || "unknown", EVIDENCE_BADGE[state] || "neutral");
}

export function confidenceBadge(level) {
  return badge(level || "unresolved", CONFIDENCE_BADGE[level] || "neutral");
}

export function statusBadge(status) {
  return badge((status || "pending_review").replace("_", " "), STATUS_BADGE[status] || "amber");
}

// Any record whose source is AI/observed and not yet engineer-accepted is
// flagged -- the skill's approval rule (section "Evidence and confidence")
// requires this stay visible everywhere the value is shown, not just on its
// own record screen.
export function pendingReviewFlag(record) {
  if (!record || record.status === "accepted") return "";
  const label = record.source_type === "inferred" ? "inferred · pending review" : "pending review";
  return `<span class="pending-flag">${esc(label)}</span>`;
}

export function gateTrack(currentStatus) {
  const idx = PROJECT_STATUSES.indexOf(currentStatus || "draft");
  return `<div class="gate-track">${PROJECT_STATUSES.map((s, i) => {
    const state = i < idx ? "done" : i === idx ? "current" : "pending";
    return `<span class="gate-step" data-state="${state}">${esc(s.replace("_", " "))}</span>`;
  }).join("")}</div>`;
}

export function syncBadge(record) {
  if (!record) return "";
  if (record._sync_status === "synced") return "";
  return `<span class="badge badge-neutral" title="Not yet synced to server">local only</span>`;
}

export function emptyState(message) {
  return `<div class="empty-state">${esc(message)}</div>`;
}
