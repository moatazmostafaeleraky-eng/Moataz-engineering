// "HVAC coverage" component name suggestions, verbatim from the skill. These
// are offered as autocomplete only -- a technician can always type a
// different name for something the list doesn't cover.
export const HVAC_COVERAGE = {
  indoor: ["housing", "front panel", "outlet", "louvers", "filters", "evaporator", "cross-flow fan", "motor", "bearings/supports", "drain pan", "drain hose", "insulation", "PCB", "sensors", "display", "wiring", "brackets", "fasteners", "airflow passages", "sealing"],
  outdoor: ["cabinet", "covers", "base", "compressor", "condenser", "axial fan", "motor", "guard", "bellmouth", "heat exchanger", "piping", "valves", "accumulator", "electrical box", "PCB", "capacitors", "sensors", "service valves", "mounts", "insulation", "fasteners"],
};

export function assemblySuggestions(scope) {
  const names = new Set();
  for (const s of scope || []) {
    for (const n of HVAC_COVERAGE[s] || []) names.add(n);
  }
  return Array.from(names);
}
