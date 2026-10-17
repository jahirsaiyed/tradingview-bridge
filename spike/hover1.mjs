import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
await page.mouse.move(100, 412);
await page.waitForTimeout(800);
await page.screenshot({ path: "state.png", clip: { x: 56, y: 360, width: 520, height: 90 } });
await browser.close();
