import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PHOTO = path.join(__dirname, "..", "fixtures", "sample-evidence.jpg");

// Component <option> labels are "<component_id> – <name>", and option
// order isn't guaranteed (IndexedDB getAll() returns key order, not
// insertion order) -- so select by matching the visible name text rather
// than assuming position or an exact label string.
async function selectComponentByName(page, selectLocator, namePart) {
  const value = await page.locator(`${selectLocator} option`, { hasText: namePart }).getAttribute("value");
  await page.locator(selectLocator).selectOption(value);
}

// Exercises the full teardown-to-report golden path through the real UI:
// create project -> checklist -> components -> evidence -> measurements ->
// validate -> compare -> BOM -> KPIs -> report/release. Each step asserts on
// what a technician would actually see, not implementation details.

test("full benchmark workflow from project creation to release", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Benchmark projects" })).toBeVisible();

  // --- 1. Create project ---
  await page.getByLabel("Title").fill("Outdoor motor benchmark");
  await page.getByLabel("outdoor").check();
  await page.getByLabel("cost").check();

  await page.locator("#prod-id-0").fill("OUR");
  await page.locator("#prod-model-0").fill("INV-24");
  await page.locator("#prod-id-1").fill("COMP");
  await page.locator("#prod-owner-1").selectOption("competitor");
  await page.locator("#prod-model-1").fill("ELA-10");

  await page.getByRole("button", { name: "Create project" }).click();

  // --- 2. Checklist ---
  await expect(page.getByRole("heading", { name: "Outdoor motor benchmark" })).toBeVisible();
  await page.getByRole("button", { name: "Generate teardown checklist" }).click();
  const checklistBoxes = page.locator("#checklist-items input[type=checkbox]");
  await expect(checklistBoxes.first()).toBeVisible();
  const count = await checklistBoxes.count();
  expect(count).toBeGreaterThan(5);
  for (let i = 0; i < count; i++) await checklistBoxes.nth(i).check();
  await expect(page.getByRole("button", { name: /Mark capture complete/ })).toBeEnabled();
  await page.getByRole("button", { name: /Mark capture complete/ }).click();

  // --- 3. Components ---
  await page.locator("#nav-tabs").getByRole("button", { name: "Components", exact: true }).click();
  await page.locator("#c-product").selectOption("OUR");
  await page.locator("#c-assembly").fill("outdoor unit");
  await page.locator("#c-name").fill("8-pole outdoor motor");
  await page.locator("#c-function").fill("condenser airflow");
  await page.locator("#c-evidence-state").selectOption("documented");
  await page.locator("#c-confidence").selectOption("medium");
  await page.locator("#c-status").selectOption("accepted");
  await page.getByRole("button", { name: "Save component" }).click();

  await page.locator("#c-product").selectOption("COMP");
  await page.locator("#c-assembly").fill("outdoor unit");
  await page.locator("#c-name").fill("10-pole outdoor motor");
  await page.locator("#c-function").fill("condenser airflow");
  await page.locator("#c-evidence-state").selectOption("documented");
  await page.locator("#c-confidence").selectOption("medium");
  await page.locator("#c-status").selectOption("accepted");
  await page.getByRole("button", { name: "Save component" }).click();

  await expect(page.locator("table").getByText("8-pole outdoor motor")).toBeVisible();
  await expect(page.locator("table").getByText("10-pole outdoor motor")).toBeVisible();

  // --- 4. Evidence ---
  await page.locator("#nav-tabs").getByRole("button", { name: "Evidence", exact: true }).click();
  await page.locator("#cap-file").setInputFiles(SAMPLE_PHOTO);
  await page.locator("#cap-desc").fill("motor nameplate");
  await page.getByRole("button", { name: "Save evidence" }).click();
  await expect(page.locator(".evidence-thumb")).toHaveCount(1);

  // --- 5. Measurements (motor cost for both products) ---
  await page.locator("#nav-tabs").getByRole("button", { name: "Measurements", exact: true }).click();
  await selectComponentByName(page, "#m-component", "8-pole outdoor motor");
  await page.locator("#m-parameter").fill("motor_cost");
  await page.locator("#m-raw-value").fill("5.2");
  await page.locator("#m-raw-unit").fill("USD");
  await page.locator("#m-source").selectOption("documented");
  await page.locator("#m-status").selectOption("accepted");
  await page.locator('input[name="evidence_ids"]').first().check();
  await page.getByRole("button", { name: "Save measurement" }).click();

  await selectComponentByName(page, "#m-component", "10-pole outdoor motor");
  await page.locator("#m-parameter").fill("motor_cost");
  await page.locator("#m-raw-value").fill("4.4");
  await page.locator("#m-raw-unit").fill("USD");
  await page.locator("#m-source").selectOption("documented");
  await page.locator("#m-status").selectOption("accepted");
  await page.locator('input[name="evidence_ids"]').first().check();
  await page.getByRole("button", { name: "Save measurement" }).click();

  await expect(page.locator("table tbody tr")).toHaveCount(2);

  // --- 6. Validation ---
  await page.locator("#nav-tabs").getByRole("button", { name: "Validate", exact: true }).click();
  await expect(page.getByText("valid", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Mark data_validated/ }).click();

  // --- 7. Compare ---
  await page.locator("#nav-tabs").getByRole("button", { name: "Compare", exact: true }).click();
  await page.locator("#cmp-parameter").fill("motor_cost");
  await page.locator("#cmp-our").selectOption("OUR");
  await page.locator("#cmp-competitor").selectOption("COMP");
  await page.locator("#compare-form").getByRole("button", { name: "Compare" }).click();
  await expect(page.getByText("absolute_delta = -0.8", { exact: false })).toBeVisible();
  await expect(page.getByText(/percentage_delta = -15\.38%/)).toBeVisible();

  await page.locator("#cmp-note").fill("purchased-cost only; motor operating point not yet evaluated");
  await page.getByRole("button", { name: "Confirm comparison" }).click();
  await expect(page.getByText("conditionally_comparable")).toBeVisible();
  await page.getByRole("button", { name: /Mark comparison_ready/ }).click();

  // --- 8. BOM ---
  await page.locator("#nav-tabs").getByRole("button", { name: "BOM", exact: true }).click();
  await expect(page.locator("table tbody tr")).toHaveCount(2);

  // --- 9. KPIs ---
  await page.locator("#nav-tabs").getByRole("button", { name: "KPIs", exact: true }).click();
  await page.locator("#k-performance").fill("3500");
  await page.locator("#k-mass").fill("35");
  await expect(page.getByText(/performance_per_mass = 100/)).toBeVisible();

  // --- 10. Report + release ---
  await page.locator("#nav-tabs").getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByText(/Status: comparison_ready/)).toBeVisible();
  await page.getByRole("button", { name: /Mark decision_reviewed/ }).click();
  await page.getByRole("button", { name: "Release" }).click();
  await expect(page.getByText(/Status: released/)).toBeVisible();
});
