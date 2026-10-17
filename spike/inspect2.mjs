import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const r = await page.evaluate(() => {
  const ed = document.querySelector("#pine-editor-dialog");
  const hdr = ed ? [...ed.parentElement.querySelectorAll("button")].slice(0, 12).map(b => ({ aria: b.getAttribute("aria-label"), title: b.getAttribute("title") })).filter(b => b.aria || b.title) : null;
  const legend = [...document.querySelectorAll('[data-name="legend-source-item"]')].map(e => ({ title: e.querySelector('[data-name="legend-source-title"]')?.innerText, btns: [...e.querySelectorAll("button")].map(b => b.getAttribute("data-name") || b.getAttribute("aria-label")) }));
  return { hdr, legend };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
