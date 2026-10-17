import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const info = await page.evaluate(() => {
  const leaf = [...document.querySelectorAll("*")].filter(e => e.children.length === 0 && (e.textContent || "").trim() === "Spike runtime" && !e.closest("#pine-editor-dialog") && !e.closest('[data-name="pine-dialog"]'));
  return leaf.map(t => {
    let row = t; for (let i = 0; i < 3 && row.parentElement; i++) row = row.parentElement;
    return { leafCls: t.className?.toString().slice(0, 60), rowHtml: row.outerHTML.replace(/\s+/g, " ").slice(0, 2500) };
  });
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: "state.png", clip: { x: 56, y: 40, width: 700, height: 150 } });
await browser.close();
