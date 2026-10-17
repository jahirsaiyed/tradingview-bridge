import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const rows = () => page.evaluate(() => [...document.querySelectorAll('[data-qa-id="legend-source-item"]')].filter(i => (i.querySelector('[data-qa-id~="legend-source-title"]')?.innerText || "").trim() === "Spike runtime").length);
for (let s = 0; s <= 20; s += 2) { const n = await rows(); console.log(s + "s rows:", n); if (n === 0) break; await page.waitForTimeout(2000); }
await page.screenshot({ path: "state.png" });
await browser.close();
