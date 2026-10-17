import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
const smallest = (re) => page.evaluate((src) => {
  const rx = new RegExp(src, "i");
  const c = [...document.querySelectorAll("div")].filter(d => rx.test(d.innerText || ""));
  c.sort((a, b) => a.innerText.length - b.innerText.length);
  return c[0] ? c[0].innerText.replace(/\n+/g, " | ").slice(0, 700) : null;
}, re.source);

console.log("== report ==\n" + await smallest(/Total P&L/));
await page.click('[id="List of Trades"]');
await page.waitForTimeout(1200);
console.log("== trades ==\n" + await smallest(/Entry|Exit/));
await page.click('[id="Strategy report"]');

await page.click('[data-name="pine-dialog"] button[title="More"]');
await page.waitForTimeout(500);
await page.getByText("Pine logs", { exact: true }).click();
await page.waitForTimeout(2000);
console.log("== logs ==\n" + await smallest(/last bar close=/));
await page.screenshot({ path: "state.png" });
await browser.close();
