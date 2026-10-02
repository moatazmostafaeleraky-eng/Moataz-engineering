// SI-canonicalization rules, straight from the hvac-benchmarking-skill's
// "Measurement, unit, and cost rules" section. The original raw value/unit a
// technician entered is always kept alongside the canonical one -- this module
// never discards the source entry, only adds a converted copy plus the factor
// and method used so the conversion itself is auditable.

export const PARAMETER_CANONICAL_UNIT = {
  mass: "kg",
  length: "m",
  thickness: "m",
  temperature: "degC",
  pressure: "Pa",
  power: "W",
  capacity: "W",
  airflow: "m3/s",
  noise: "dB",
  cost: null, // stays in project currency; the raw unit IS the currency code
};

// parameter -> dimension, used to decide which conversion table applies.
const PARAMETER_DIMENSION = {
  mass: "mass", weight: "mass",
  length: "length", width: "length", height: "length", depth: "length",
  diameter: "length", thickness: "thickness",
  temperature: "temperature",
  pressure: "pressure",
  input_power: "power", power: "power",
  cooling_capacity: "capacity", heating_capacity: "capacity", capacity: "capacity",
  airflow: "airflow",
  noise: "noise", sound_pressure: "noise",
  motor_cost: "cost", component_cost: "cost", total_cost: "cost", cost: "cost",
};

// unit -> [factor to canonical, offset] for linear conversions (value*factor+offset = canonical)
const LINEAR = {
  mass: { kg: [1, 0], g: [0.001, 0], lb: [0.45359237, 0], oz: [0.028349523, 0] },
  length: { m: [1, 0], mm: [0.001, 0], cm: [0.01, 0], in: [0.0254, 0], ft: [0.3048, 0] },
  thickness: { m: [1, 0], mm: [0.001, 0], cm: [0.01, 0], in: [0.0254, 0] },
  pressure: { Pa: [1, 0], kPa: [1000, 0], bar: [100000, 0], psi: [6894.757, 0], MPa: [1000000, 0] },
  power: { W: [1, 0], kW: [1000, 0], HP: [745.699872, 0], "BTU/h": [0.29307107, 0] },
  capacity: { W: [1, 0], kW: [1000, 0], "BTU/h": [0.29307107, 0], ton: [3516.853, 0] },
  airflow: { "m3/s": [1, 0], "m3/h": [1 / 3600, 0], CFM: [0.000471947, 0], "L/s": [0.001, 0] },
  noise: { dB: [1, 0] },
};

function convertTemperature(value, unit) {
  switch (unit) {
    case "degC": return { value, factor: 1, method: "identity (already degC)" };
    case "degF": return { value: (value - 32) * (5 / 9), factor: null, method: "(F - 32) * 5/9" };
    case "K": return { value: value - 273.15, factor: null, method: "K - 273.15" };
    default: return null;
  }
}

export function dimensionFor(parameter) {
  return PARAMETER_DIMENSION[parameter] || null;
}

export function unitsFor(parameter) {
  const dim = dimensionFor(parameter);
  if (!dim) return [];
  if (dim === "temperature") return ["degC", "degF", "K"];
  if (dim === "cost") return []; // free text currency code
  return Object.keys(LINEAR[dim] || {});
}

// Returns { canonical_value, canonical_unit, factor, method } or null when the
// parameter/unit combination has no defined conversion (caller should then
// require the technician to supply the canonical value manually and mark it
// `inferred`/`unknown` per the skill's evidence-state vocabulary).
export function toCanonical(parameter, rawValue, rawUnit) {
  const dim = dimensionFor(parameter);
  const value = Number(rawValue);
  if (!dim || Number.isNaN(value)) return null;

  if (dim === "cost") {
    return { canonical_value: value, canonical_unit: rawUnit, factor: 1, method: "pass-through (currency, no SI conversion)" };
  }
  if (dim === "temperature") {
    const converted = convertTemperature(value, rawUnit);
    if (!converted) return null;
    return { canonical_value: converted.value, canonical_unit: "degC", factor: converted.factor, method: converted.method };
  }
  const table = LINEAR[dim];
  const entry = table && table[rawUnit];
  if (!entry) return null;
  const [factor, offset] = entry;
  return {
    canonical_value: value * factor + offset,
    canonical_unit: PARAMETER_CANONICAL_UNIT[dim] || Object.keys(table).find((u) => table[u][0] === 1),
    factor,
    method: `value * ${factor}${offset ? ` + ${offset}` : ""}`,
  };
}
