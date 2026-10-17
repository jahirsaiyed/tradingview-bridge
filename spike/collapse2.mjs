import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
await page.mouse.click(79, 413);
await page.waitForTimeout(800);
console.log("collapsed label:", await page.evaluate(() => [...document.querySelectorAll("button")].map(b => b.getAttribute("aria-label")).filter(l => /legend|indicator/i.test(l || "")).join(",")));
await browser.close();
