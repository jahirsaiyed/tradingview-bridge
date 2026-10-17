import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));

// Strategy report: find smallest element containing known labels
const rep = await page.evaluate(() => {
  const labels = ["Total P&L", "Max equity drawdown", "Total trades", "Profit factor", "Percent profitable"];
  const cands = [...document.querySelectorAll("div")].filter(d => labels.filter(l => d.innerText?.includes(l)).length >= 3);
  cands.sort((a,b) => a.innerText.length - b.innerText.length);
  const el = cands[0];
  return el ? { len: el.innerText.length, text: el.innerText.replace(/\n+/g," | ").slice(0, 900) } : { error: "not found" };
});
console.log("== report ==\n" + JSON.stringify(rep, null, 2));

// Pine logs
await page.click('[data-name="pine-dialog"] button[title="More"]');
await page.waitForTimeout(400);
await page.click('text=Pine logs');
await page.waitForTimeout(1500);
const logs = await page.evaluate(() => {
  const hits = [...document.querySelectorAll("div")].filter(d => /last bar close=/.test(d.innerText || ""));
  hits.sort((a,b) => a.innerText.length - b.innerText.length);
  return hits[0] ? hits[0].innerText.replace(/\n+/g, " | ").slice(0, 400) : "log line not found";
});
console.log("== pine logs ==\n" + logs);
await page.screenshot({ path: "probe7.png" });
await browser.close();
