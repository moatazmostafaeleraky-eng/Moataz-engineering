// Mirrors generate_teardown_checklist()'s item library in app.py exactly, so
// a checklist can be generated offline and later reconciled with the server
// copy without surprising a technician with a different task list.

export const BASE_ITEMS = [
  "overview photos",
  "nameplate and label photos",
  "component IDs",
  "evidence links",
  "unknowns and conflicts",
];

export const SCOPE_LIBRARY = {
  indoor: ["housing", "air path", "evaporator", "cross-flow fan", "drain system", "PCB and sensors"],
  outdoor: ["cabinet", "compressor", "condenser", "axial fan and motor", "piping and valves", "electrical box"],
  performance: ["test method", "ambient conditions", "voltage/frequency", "fan speed", "refrigerant state", "uncertainty"],
  cost: ["currency/date", "supplier basis", "raw material cost", "cycle cost", "structure cost", "subtotal reconciliation"],
};

export function buildChecklistItems(scope) {
  const extra = (scope || []).flatMap((group) => SCOPE_LIBRARY[group] || []);
  return [...BASE_ITEMS, ...extra];
}
