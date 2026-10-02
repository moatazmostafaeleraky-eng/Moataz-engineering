// Client-side ID generation matching the backend's uid() prefixes exactly
// (see app.py: uid("BM"), uid("CMP"), ...). Every create endpoint in the
// Flask prototype accepts a caller-supplied id, so generating the canonical
// ID on-device means there is no remap step once a record syncs -- the
// local id IS the permanent id.

function hex(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function uid(prefix) {
  return `${prefix}-${hex(5).toUpperCase()}`;
}
