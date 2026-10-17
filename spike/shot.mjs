import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
console.log("pine-dialog present:", await page.locator('[data-name="pine-dialog"]').count());
console.log("tabs:", await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map(t => t.id)));
await page.screenshot({ path: "state.png" });
await browser.close();
