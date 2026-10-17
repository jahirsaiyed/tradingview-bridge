import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const info = await page.evaluate(() => {
  const t = [...document.querySelectorAll('[data-qa-id~="legend-source-title"]')].find(e => (e.innerText || "").trim() === "Spike runtime");
  if (!t) return { error: "title not found" };
  let item = t; const chain = [];
  while (item.parentElement) { item = item.parentElement; chain.push(item.getAttribute("data-qa-id") || item.getAttribute("data-name") || null); if ((item.getAttribute("data-qa-id") || "").includes("legend-source-item")) break; if (chain.length > 8) break; }
  const desc = [...item.querySelectorAll("[data-qa-id], [data-name], [title], [aria-label]")].map(e => ({ qa: e.getAttribute("data-qa-id"), dn: e.getAttribute("data-name"), title: e.getAttribute("title"), aria: e.getAttribute("aria-label") })).filter(d => d.qa || d.dn || d.title || d.aria);
  return { chain, itemQa: item.getAttribute("data-qa-id"), desc };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
