import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("tradingview.com/chart"));
const ed = '[data-name="pine-dialog"]';
if (!(await page.locator(ed).isVisible().catch(() => false))) { await page.click('[data-name="pine-dialog-button"]'); }
await page.locator(ed).waitFor({ state: "visible", timeout: 10000 });
await page.waitForTimeout(800);
const src = () => page.evaluate(() => [...document.querySelectorAll('[data-name="pine-dialog"] .view-line')].map(l => l.textContent).join("\n").replace(/ /g, " "));
const s0 = await src();
if (!s0.includes("Spike strat")) { console.log("ABORT: not scratch strategy"); process.exit(2); }

// --- Pine logs (menu item by role)
await page.click(`${ed} button[title="More"]`);
await page.waitForTimeout(500);
await page.locator('[role="menuitem"]', { hasText: /^Pine logs$/ }).click();
await page.waitForTimeout(2500);
const help = await page.getByText("Help Center", { exact: true }).count();
console.log("help overlay opened:", help > 0);
const logs = await page.evaluate(() => {
  const c = [...document.querySelectorAll("div")].filter(d => /last bar close=/.test(d.innerText || ""));
  c.sort((a, b) => a.innerText.length - b.innerText.length);
  return c[0] ? c[0].innerText.replace(/\n+/g, " | ").slice(0, 300) : null;
});
console.log("pine logs:", logs);
await page.screenshot({ path: "state.png" });
await browser.close();
