import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const r = await page.evaluate(() => {
  const m = document.querySelector(".monaco-editor");
  const chain = []; let e = m;
  while (e && chain.length < 12) { chain.push({ tag: e.tagName.toLowerCase(), dn: e.getAttribute("data-name"), id: e.id || null }); e = e.parentElement; }
  return { monacoCount: document.querySelectorAll(".monaco-editor").length, pineDialogCount: document.querySelectorAll('[data-name="pine-dialog"]').length, chain: chain.filter(c => c.dn || c.id) };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
