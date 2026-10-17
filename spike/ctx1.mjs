import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
await page.mouse.click(105, 412, { button: "right" });
await page.waitForTimeout(1000);
await page.screenshot({ path: "state.png", clip: { x: 56, y: 330, width: 560, height: 360 } });
await browser.close();
