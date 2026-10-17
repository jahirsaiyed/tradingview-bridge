import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const row = page.locator('[data-qa-id="legend-source-item"]').filter({ has: page.locator('[data-qa-id~="legend-source-title"]', { hasText: /^Spike runtime$/ }) });
console.log("rows matching:", await row.count());
await row.first().locator('[data-qa-id="legend-delete-action"]').click({ timeout: 5000 });
for (let i = 0; i < 10; i++) { await page.waitForTimeout(500); if ((await row.count()) === 0) { console.log("removed after", (i + 1) * 500, "ms"); break; } }
console.log("rows after:", await row.count());
await page.screenshot({ path: "state.png" });
await browser.close();
