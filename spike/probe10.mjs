import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("tradingview.com/chart"));
const ed = '#pine-editor-dialog';
const src = () => page.evaluate(() => [...document.querySelectorAll('#pine-editor-dialog .view-line')].map(l => l.textContent).join("\n").replace(/ /g, " "));
if (!(await src()).includes("Spike strat")) { console.log("ABORT: not scratch strategy"); process.exit(2); }

// 1) Trade list
await page.click('[id="List of Trades"]');
await page.waitForTimeout(1500);
const trades = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('[role="row"], tr')].slice(0, 5).map(r => r.innerText.replace(/\s+/g, " ").trim().slice(0, 140));
  return rows;
});
console.log("trade rows:", JSON.stringify(trades, null, 1));
await page.click('[id="Strategy report"]');

// 2) Runtime error script
const SRC = `//@version=6
indicator("Spike runtime")
a = array.new_float(1, 1.0)
if barstate.islast
    log.info("x={0}", array.get(a, 5))
plot(close)
`;
await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://www.tradingview.com" }).catch(() => {});
await page.click(`${ed} .monaco-editor .view-lines`);
await page.evaluate(t => navigator.clipboard.writeText(t), SRC);
await page.keyboard.press("Control+A"); await page.keyboard.press("Control+V");
await page.waitForTimeout(500);
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(5000);
const consoleTail = await page.evaluate(() => { const t = document.querySelector('#pine-editor-dialog').innerText; return t.slice(-420); });
console.log("---- editor console ----\n" + consoleTail);
const logsPane = await page.evaluate(() => document.body.innerText.match(/\[2026[^\n]*\n?[^\n]*/g)?.slice(-3));
console.log("---- log lines ----\n" + JSON.stringify(logsPane));
await page.screenshot({ path: "state.png" });
await browser.close();
