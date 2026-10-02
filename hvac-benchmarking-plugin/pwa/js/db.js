// IndexedDB data layer. Every workflow write lands here first (optimistic,
// offline-capable) and is mirrored into sync_queue for the sync engine to
// replay against the Flask backend once the device is online.

const DB_NAME = "hvac-benchmark";
const DB_VERSION = 1;

const STORES = {
  projects: "project_id",
  checklists: "checklist_id",
  components: "component_id",
  evidence: "evidence_id",
  measurements: "measurement_id",
  observations: "observation_id",
  sync_queue: "seq",
  meta: "key",
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const opts = name === "sync_queue" ? { keyPath, autoIncrement: true } : { keyPath };
        const store = db.createObjectStore(name, opts);
        if (name === "components" || name === "measurements" || name === "evidence" || name === "observations" || name === "checklists") {
          store.createIndex("by_project", "project_id", { unique: false });
        }
        if (name === "sync_queue") {
          store.createIndex("by_status", "status", { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

export async function putRecord(storeName, record) {
  const store = await tx(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}

export async function getRecord(storeName, key) {
  const store = await tx(storeName, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(storeName) {
  const store = await tx(storeName, "readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllByProject(storeName, projectId) {
  const store = await tx(storeName, "readonly");
  return new Promise((resolve, reject) => {
    const index = store.index("by_project");
    const req = index.getAll(projectId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecord(storeName, key) {
  const store = await tx(storeName, "readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getMeta(key, fallback = null) {
  const row = await getRecord("meta", key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  return putRecord("meta", { key, value });
}

// --- sync queue -------------------------------------------------------

export async function enqueueSync(entry) {
  const store = await tx("sync_queue", "readwrite");
  const record = {
    status: "pending",
    attempts: 0,
    last_error: null,
    created_at: new Date().toISOString(),
    ...entry,
  };
  return new Promise((resolve, reject) => {
    const req = store.add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingSync() {
  const store = await tx("sync_queue", "readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []).filter((r) => r.status !== "done"));
    req.onerror = () => reject(req.error);
  });
}

export async function updateSyncEntry(seq, patch) {
  const store = await tx("sync_queue", "readwrite");
  return new Promise((resolve, reject) => {
    const getReq = store.get(seq);
    getReq.onsuccess = () => {
      const record = { ...getReq.result, ...patch };
      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export { STORES };
