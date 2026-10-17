import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const page = browser.contexts()[0].pages().find(p => p.url().includes("tradingview.com/chart"));
for (let i = 0; i < 6; i++) {
  const s = await page.evaluate(() => {
    const t = document.body.innerText;
    return { hasPnL: /Total P&L/i.test(t), hasNetProfit: /Net profit/i.test(t), hasNoTrades: /no trades|There are no/i.test(t), visibility: document.visibilityState, hasFocus: document.hasFocus() };
  });
  console.log(i * 3 + "s", JSON.stringify(s));
  if (s.hasPnL || s.hasNetProfit) break;
  await page.waitForTimeout(3000);
}
await browser.close();
