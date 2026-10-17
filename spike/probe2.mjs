import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes("tradingview.com/chart"));
const out = await page.evaluate(() => {
  const root = document.querySelector('[data-name="pine-dialog"]');
  if (!root) return { error: "pine-dialog not found (is Pine Editor open?)" };
  const attrs = el => ({ tag: el.tagName.toLowerCase(), dn: el.getAttribute("data-name"), aria: el.getAttribute("aria-label"), title: el.getAttribute("title"), text: (el.textContent||"").trim().slice(0,40) });
  return {
    rect: root.getBoundingClientRect().toJSON(),
    monacoEditors: root.querySelectorAll(".monaco-editor").length,
    textareas: [...root.querySelectorAll("textarea")].map(t => ({ cls: t.className, aria: t.getAttribute("aria-label") })),
    buttons: [...root.querySelectorAll("button")].map(attrs),
    dataNames: [...new Set([...root.querySelectorAll("[data-name]")].map(e => e.getAttribute("data-name")))],
    firstLines: [...root.querySelectorAll(".view-line")].slice(0,5).map(l => l.textContent),
  };
});
console.log(JSON.stringify(out, null, 2));
await browser.close();
