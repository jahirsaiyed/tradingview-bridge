import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));

// Strategy report content
const report = await page.evaluate(() => {
  const tab = document.getElementById("Strategy report");
  const panelId = tab?.getAttribute("aria-controls");
  const panel = (panelId && document.getElementById(panelId)) || tab?.closest("[class*=container], [class*=Container]");
  return { panelId, hasPanel: !!panel, text: panel ? panel.innerText.slice(0, 1200) : null };
});
console.log("== Strategy report ==\n" + JSON.stringify(report, null, 2));

// List of trades
await page.click('[id="List of Trades"]');
await page.waitForTimeout(1000);
const trades = await page.evaluate(() => {
  const tab = document.getElementById("List of Trades");
  const panel = document.getElementById(tab.getAttribute("aria-controls") || "");
  return panel ? panel.innerText.slice(0, 600) : "no panel via aria-controls";
});
console.log("== List of trades ==\n" + trades);
await page.click('[id="Strategy report"]');

// Pine Logs entry point: open "More" menu in the editor
await page.click('[data-name="pine-dialog"] button[title="More"]');
await page.waitForTimeout(600);
const menu = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"], [role="option"], [data-name*="menu"] [class*="item"]')].map(e => e.innerText.trim().replace(/\s+/g," ").slice(0,50)).filter(Boolean));
console.log("== More menu items ==\n" + JSON.stringify(menu));
await page.keyboard.press("Escape");
await browser.close();
