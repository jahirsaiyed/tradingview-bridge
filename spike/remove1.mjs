import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const res = await page.evaluate(() => {
  const matches = [];
  for (const btn of document.querySelectorAll('button[title="Remove"]')) {
    let el = btn.parentElement, hops = 0;
    while (el && hops < 6) {
      const t = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (t.length > 0) { if (t.length < 40 && t.startsWith("Spike runtime")) matches.push({ btn, text: t }); break; }
      el = el.parentElement; hops++;
    }
  }
  if (matches.length !== 1) return { removed: false, count: matches.length, texts: matches.map(m => m.text) };
  matches[0].btn.click();
  return { removed: true, text: matches[0].text };
});
console.log(JSON.stringify(res));
await page.waitForTimeout(1500);
const legend = await page.evaluate(() => /Spike runtime/.test(document.body.innerText));
console.log("Spike runtime still in page text:", legend);
await page.screenshot({ path: "state.png" });
await browser.close();
