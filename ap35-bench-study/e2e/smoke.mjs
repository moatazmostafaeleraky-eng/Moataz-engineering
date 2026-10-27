/**
 * Browser smoke test: loads the built (or dev) app, drives the main controls,
 * every workspace, view mode and tab, clicks every visible button in the
 * panels, checks cancellation and the phone layout, and fails on any console
 * error or uncaught exception. Screenshots go to e2e/shots/.
 *
 *   npm run build && npm run serve        (in one terminal)
 *   npm run smoke [-- http://localhost:4173/]
 *
 * Needs Playwright with Chromium: `npm i -D playwright && npx playwright install chromium`
 * (or set PLAYWRIGHT_MODULE to an existing playwright/index.js).
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });
const url = process.argv[2] || 'http://localhost:4173/';

let pw;
try { pw = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright'); }
catch { console.error('Playwright not found. Install it with: npm i -D playwright && npx playwright install chromium'); process.exit(2); }
const { chromium } = pw.default ?? pw;

const results = [];
const errors = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('filechooser', (fc) => fc.setFiles([]).catch(() => {}));
page.on('dialog', (d) => d.dismiss().catch(() => {}));

await page.goto(url);
await page.waitForSelector('#stage canvas', { timeout: 30000 });
check('page loads with a WebGL canvas', true);
await page.waitForTimeout(1500);

// ---- live run
await page.click('.startcta');
await page.selectOption('select[aria-label="Simulation speed"]', '60');
await page.waitForTimeout(6000);
const kpi = await page.locator('#right').innerText();
check('cooling starts and readouts update', /kW/.test(kpi) && /COOLING|MODULATING|STARTING|START_DELAY/.test(kpi), kpi.split('\n').slice(0, 3).join(' | '));
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(n / 3); }; requestAnimationFrame(f); }));
check('render loop runs', fps > 3, `${fps.toFixed(1)} fps (software GL in CI is much slower than a GPU)`);
await page.screenshot({ path: join(shots, 'desktop-explore.png') });

// ---- view modes
for (const k of ['1', '2', '3', '4', '5', '6', '7', '8']) { await page.keyboard.press(k); await page.waitForTimeout(700); }
await page.screenshot({ path: join(shots, 'desktop-exploded.png') });
await page.keyboard.press('1');
check('8 view modes switch without errors', errors.length === 0);

// ---- every workspace, every tab, every visible button inside panes
const clickAllButtons = async (scope) => {
  const btns = page.locator(`${scope} button:visible`);
  const n = await btns.count();
  let clicked = 0;
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    const label = ((await b.textContent().catch(() => '')) || '').trim();
    if (/^(Run sweep|Run A\/B|Run robustness|Run validation|Calibrate|Stop|Reset all|Delete|Run counterfactual|Present)/i.test(label)) continue; // long jobs are driven explicitly below
    if (await b.isDisabled().catch(() => true)) continue;
    await b.click({ timeout: 2000 }).catch(() => {});
    clicked++;
    await page.waitForTimeout(60);
    await page.keyboard.press('Escape').catch(() => {});
  }
  return clicked;
};
for (const ws of ['explore', 'engineer', 'lab']) {
  await page.click(`button[data-ws="${ws}"]`);
  await page.waitForTimeout(400);
  const tabs = await page.locator('#bottom [data-tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')));
  for (const t of tabs) {
    const before = errors.length;
    await page.click(`#bottom button[data-tab="${t}"]`);
    await page.waitForTimeout(t === 'drawings' ? 2500 : 500);
    const n = await clickAllButtons('#bottom .tabbody');
    check(`${ws} / tab ${t} (${n} buttons clicked)`, errors.length === before, errors.slice(before).join(' ; '));
  }
}
const beforeLeft = errors.length;
const nl = await clickAllButtons('#left');
check(`left panel buttons (${nl} clicked)`, errors.length === beforeLeft, errors.slice(beforeLeft).join(' ; '));

// ---- design lab: experiment copy, A/B, cancellation
await page.click('button[data-ws="lab"]');
await page.fill('input[placeholder="experiment name"]', 'Smoke copy');
await page.click('text=New copy');
await page.waitForTimeout(300);
check('experiment copy created', (await page.locator('#hdr').innerText()).includes('Smoke copy'));
await page.click('#bottom button[data-tab="compare"]');
await page.click('text=Run A/B');
await page.waitForSelector('text=Time to target (band held)', { timeout: 180000 });
check('A/B compare produces a metric table', true);
await page.click('#bottom button[data-tab="sweep"]');
await page.click('text=Run sweep');
await page.waitForTimeout(2500);
const t0 = Date.now();
await page.click('#bottom .tabbody button:has-text("Cancel")');
await page.waitForFunction(() => { const s = document.querySelector('#bottom')?.textContent ?? ''; return /CANCELLED|Cancelled/.test(s); }, null, { timeout: 15000 }).then(() => check('sweep cancels', true, `${((Date.now() - t0) / 1000).toFixed(1)} s`)).catch(() => check('sweep cancels', false));
await page.screenshot({ path: join(shots, 'desktop-lab.png') });

// ---- command assistant + Arabic narration
await page.keyboard.press('Control+k');
await page.fill('input[aria-label="Command"]', 'set fan to high');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
await page.keyboard.press('Escape');
await page.click('#hdr .chip:has-text("EN")');
await page.waitForTimeout(800);
check('Arabic toggle renders Arabic text', /[؀-ۿ]/.test(await page.locator('#right').innerText()));
await page.screenshot({ path: join(shots, 'desktop-arabic.png') });
await page.click('#hdr .chip:has-text("EN")');

// ---- phone layout (close the desktop page first so it does not compete for CPU)
await ctx.close();
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const pp = await phone.newPage();
pp.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
pp.on('console', (m) => { if (m.type() === 'error') errors.push('phone: ' + m.text()); });
await pp.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await pp.waitForSelector('#stage canvas', { timeout: 60000 });
await pp.waitForTimeout(2500);
const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('phone: no horizontal page overflow', overflow <= 1, `${overflow}px`);
await pp.screenshot({ path: join(shots, 'phone.png') });
await pp.screenshot({ path: join(shots, 'phone-full.png'), fullPage: true });

check('no console errors or uncaught exceptions', errors.length === 0, errors.slice(0, 5).join(' ; '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
process.exit(failed.length ? 1 : 0);
