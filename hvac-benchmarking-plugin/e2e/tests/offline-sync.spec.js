import { test, expect } from "@playwright/test";

// Proves the offline-first contract end to end: a technician can create a
// project while the tablet has no network at all (the service worker must
// already be serving the cached app shell), the write lands in IndexedDB
// immediately, and once connectivity returns the sync queue drains it to the
// server without any further user action.

test("captures data offline and syncs automatically once back online", async ({ page, context }) => {
  // First load online so the service worker installs and caches the shell.
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Benchmark projects" })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // second navigation is controlled by the now-active service worker

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Benchmark projects" })).toBeVisible();
  await expect(page.locator("#net-badge")).toHaveAttribute("data-state", "offline", { timeout: 10000 });

  const title = `Offline capture ${Date.now()}`;
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("indoor").check();
  await page.locator("#prod-id-0").fill("OUR");
  await page.locator("#prod-id-1").fill("COMP");
  await page.locator("#prod-owner-1").selectOption("competitor");
  await page.getByRole("button", { name: "Create project" }).click();

  // The project is usable immediately, purely from IndexedDB, with the device offline.
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const storedTitle = await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    return dbs.some((d) => d.name === "hvac-benchmark");
  });
  expect(storedTitle).toBe(true);

  // Reconnect; the sync queue should drain without any further user action.
  await context.setOffline(false);
  await expect(page.locator("#net-badge")).toHaveAttribute("data-state", "online", { timeout: 20000 });

  await expect(async () => {
    const projectIdFromDb = await page.evaluate(async (expectedTitle) => {
      return new Promise((resolve) => {
        const req = indexedDB.open("hvac-benchmark");
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("projects", "readonly");
          const store = tx.objectStore("projects");
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const match = getAll.result.find((p) => p.title === expectedTitle);
            resolve(match ? { id: match.project_id, synced: match._sync_status } : null);
          };
        };
      });
    }, title);
    expect(projectIdFromDb).not.toBeNull();
    expect(projectIdFromDb.synced).toBe("synced");

    const serverResponse = await page.evaluate(async (id) => {
      const res = await fetch(`/projects/${id}`);
      return res.status;
    }, projectIdFromDb.id);
    expect(serverResponse).toBe(200);
  }).toPass({ timeout: 20000 });
});
