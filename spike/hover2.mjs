import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
await page.mouse.move(600, 600);
await page.mouse.move(90, 405, { steps: 8 });
await page.mouse.move(105, 412, { steps: 5 });
await page.waitForTimeout(1200);
await page.screenshot({ path: "state.png", clip: { x: 56, y: 380, width: 520, height: 60 } });
await browser.close();
