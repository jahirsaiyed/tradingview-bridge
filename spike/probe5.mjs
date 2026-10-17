import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("tradingview.com/chart"));
const lines = () => page.evaluate(() => [...document.querySelectorAll('[data-name="pine-dialog"] .view-line')].map(l => l.textContent.replace(/ /g," ")));
const before = await lines();
if (!(before.some(l => l.includes("Spike paste")) && before.length <= 10)) { console.log("ABORT: editor is not the scratch script"); process.exit(2); }

const SRC = `//@version=6
strategy("Spike strat", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
fast = ta.sma(close, 10)
slow = ta.sma(close, 30)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("L")
if barstate.islast
    log.info("last bar close={0} fast={1}", close, fast)
plot(fast)
plot(slow)
`;
await ctx.grantPermissions(["clipboard-read","clipboard-write"], { origin: "https://www.tradingview.com" }).catch(()=>{});
await page.click('[data-name="pine-dialog"] .monaco-editor .view-lines');
await page.evaluate(t => navigator.clipboard.writeText(t), SRC);
await page.keyboard.press("Control+A"); await page.keyboard.press("Control+V");
await page.waitForTimeout(500);
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const root = document.querySelector('[data-name="pine-dialog"]');
  const txt = root.innerText;
  return {
    consoleTail: txt.slice(txt.indexOf("problem") - 5 > 0 ? txt.indexOf("problem") - 5 : -500).slice(-700),
    dataNames: [...new Set([...document.querySelectorAll("[data-name]")].map(e => e.getAttribute("data-name")))].filter(n => /back|strateg|tester|log|report|pine|legend|source|sources|study|chart-status/i.test(n)),
    legendText: [...document.querySelectorAll('[data-name="legend"], [class*="legend"]')].slice(0,2).map(e => e.innerText.slice(0,200)),
    tabs: [...document.querySelectorAll('[role="tab"]')].map(t => ({ id: t.id, text: t.innerText.trim().slice(0,30), selected: t.getAttribute("aria-selected") })),
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "probe5.png" });
await browser.close();
