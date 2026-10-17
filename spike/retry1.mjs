import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const src = await page.evaluate(() => [...document.querySelectorAll('[data-name="pine-dialog"] .view-line')].map(l => l.textContent).join("").replace(/ /g, " "));
if (!src.includes("Spike strat")) { console.log("ABORT: scratch strategy not in editor"); process.exit(2); }
await page.click('[data-name="pine-dialog"] .monaco-editor .view-lines');
await page.keyboard.press("Control+Enter");
const t0 = Date.now();
let ready = false;
while (Date.now() - t0 < 45000) {
  ready = await page.evaluate(() => /Total P&L|Net profit|Total trades/i.test(document.body.innerText));
  if (ready) break;
  await page.waitForTimeout(2000);
}
console.log("report ready:", ready, "after", Math.round((Date.now() - t0) / 1000) + "s");
const tail = await page.evaluate(() => { const t = document.querySelector('[data-name="pine-dialog"]').innerText; return t.slice(-260); });
console.log(tail);
await page.screenshot({ path: "state.png" });
await browser.close();
