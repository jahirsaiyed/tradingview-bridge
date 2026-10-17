import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const info = await page.evaluate(() => {
  const describe = (e) => { const out = []; let n = e; for (let i = 0; i < 5 && n; i++, n = n.parentElement) out.push({ tag: n.tagName.toLowerCase(), qa: n.getAttribute("data-qa-id"), dn: n.getAttribute("data-name"), aria: n.getAttribute("aria-label"), title: n.getAttribute("title"), cls: (n.className || "").toString().slice(0, 50) }); return out; };
  const pts = [[85, 125], [79, 413]];
  const direct = [...document.querySelectorAll('[data-qa-id*="legend"]')].map(e => e.getAttribute("data-qa-id")).filter((v, i, a) => a.indexOf(v) === i);
  return { at: pts.map(([x, y]) => ({ x, y, chain: describe(document.elementFromPoint(x, y)) })), legendQaIds: direct };
});
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: "state.png", clip: { x: 56, y: 40, width: 400, height: 120 } });
await browser.close();
