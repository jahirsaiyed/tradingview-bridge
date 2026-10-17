import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
await page.mouse.click(79, 685);
await page.waitForTimeout(1000);
await page.screenshot({ path: "state.png", clip: { x: 56, y: 600, width: 700, height: 150 } });
await browser.close();
