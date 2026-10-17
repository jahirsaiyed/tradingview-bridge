import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
const menuOpen = await page.getByText("Reset chart view", { exact: true }).count();
console.log("context menu still open:", menuOpen > 0);
await page.screenshot({ path: "state.png" });
await browser.close();
