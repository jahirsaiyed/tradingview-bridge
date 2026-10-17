import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
await page.mouse.click(1887, 32);
await page.waitForTimeout(1000);
await page.screenshot({ path: "state.png" });
await browser.close();
