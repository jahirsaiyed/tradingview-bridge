import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const rowsWith = () => page.evaluate(() => [...document.querySelectorAll('[data-qa-id="legend-source-item"]')].filter(i => (i.querySelector('[data-qa-id~="legend-source-title"]')?.innerText || "").trim() === "Spike runtime").length);
console.log("rows before:", await rowsWith());
const clicked = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-qa-id="legend-source-item"]')].filter(i => (i.querySelector('[data-qa-id~="legend-source-title"]')?.innerText || "").trim() === "Spike runtime");
  if (rows.length !== 1) return false;
  rows[0].querySelector('[data-qa-id="legend-delete-action"]').click();
  return true;
});
console.log("clicked:", clicked);
for (let i = 0; i < 8; i++) { await page.waitForTimeout(500); if ((await rowsWith()) === 0) { console.log("removed after", (i + 1) * 500, "ms"); break; } }
console.log("rows after:", await rowsWith());
await browser.close();
