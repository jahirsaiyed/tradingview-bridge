import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const ed = '[data-name="pine-dialog"]';
const src = await page.evaluate(() => [...document.querySelectorAll('[data-name="pine-dialog"] .view-line')].map(l => l.textContent).join("\n").replace(/ /g, " "));
if (!src.includes("Spike runtime")) { console.log("ABORT: editor is not the runtime scratch"); process.exit(2); }
await page.click(`${ed} .monaco-editor .view-lines`);
await page.keyboard.press("Control+Enter");
await page.waitForTimeout(4500);
const info = await page.evaluate(() => {
  const bangs = [...document.querySelectorAll("*")].filter(e => e.children.length === 0 && (e.textContent || "").trim() === "!");
  const out = bangs.map(b => {
    let row = b, hops = 0;
    while (row.parentElement && hops < 8 && !((row.innerText || "").includes("Spike runtime") && (row.innerText || "").length < 60)) { row = row.parentElement; hops++; }
    const attrs = e => ({ tag: e.tagName.toLowerCase(), cls: (e.className && e.className.toString().slice(0, 80)) || null, dn: e.getAttribute("data-name"), title: e.getAttribute("title"), aria: e.getAttribute("aria-label"), role: e.getAttribute("role") });
    const r = b.getBoundingClientRect();
    return { badge: attrs(b), parentChain: [b.parentElement, b.parentElement?.parentElement].map(p => p && attrs(p)), rowText: (row.innerText || "").replace(/\s+/g, " ").slice(0, 60), rowHtml: row.outerHTML.slice(0, 1200), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
