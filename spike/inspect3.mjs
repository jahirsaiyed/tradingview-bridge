import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const r = await page.evaluate(() => [...document.querySelectorAll("button, [role=button]")].map(b => { const bb = b.getBoundingClientRect(); return { aria: b.getAttribute("aria-label"), title: b.getAttribute("title"), x: Math.round(bb.x + bb.width/2), y: Math.round(bb.y + bb.height/2) }; }).filter(b => /overlay|split|move|float|dock|expand|maximi/i.test((b.aria||"") + " " + (b.title||""))));
console.log(JSON.stringify(r, null, 1));
await browser.close();
