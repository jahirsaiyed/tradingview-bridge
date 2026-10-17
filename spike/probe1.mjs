import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap(c => c.pages());
console.log("pages:", pages.map(p => p.url()));
const page = pages.find(p => p.url().includes("tradingview.com/chart"));
if (!page) { console.log("No TradingView chart tab found"); process.exit(1); }
const info = await page.evaluate(() => ({
  title: document.title,
  loggedIn: !document.querySelector('[data-name="header-user-menu-sign-in"]'),
  monacoGlobal: typeof window.monaco,
  dataNames: [...new Set([...document.querySelectorAll("[data-name]")].map(e => e.getAttribute("data-name")))].sort(),
}));
console.log(JSON.stringify(info, null, 2));
await browser.close();
