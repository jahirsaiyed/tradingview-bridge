import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
await page.mouse.click(1730, 320);
await page.waitForTimeout(2500);
console.log("help overlay:", await page.getByText("Help Center", { exact: true }).count());
await page.screenshot({ path: "state.png" });
await browser.close();
