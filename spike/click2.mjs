import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
await page.getByRole("button", { name: "Move editor to split-view" }).click();
await page.waitForTimeout(3500);
const logs = await page.evaluate(() => {
  const c = [...document.querySelectorAll("div")].filter(d => /last bar close=/.test(d.innerText || ""));
  c.sort((a, b) => a.innerText.length - b.innerText.length);
  return c[0] ? c[0].innerText.replace(/\n+/g, " | ").slice(0, 300) : null;
});
console.log("pine logs text:", logs);
await page.screenshot({ path: "state.png" });
await browser.close();
