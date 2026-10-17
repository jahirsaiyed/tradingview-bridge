import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("tradingview.com/chart"));
const lines = () => page.evaluate(() => [...document.querySelectorAll('[data-name="pine-dialog"] .view-line')].map(l => l.textContent.replace(/ /g," ")));
const before = await lines();
const safe = before.some(l => l.includes("Spike test") || l.includes("My script")) && before.length <= 10;
if (!safe) { console.log("ABORT: editor is not the scratch script"); process.exit(2); }

const SRC = `//@version=6
indicator("Spike paste", overlay=true)
f(x) =>
    y = math.max(x, open) * 2
    z = (y > 0) ? y : -y
    z
plot(f(close) +)
`;
try { await ctx.grantPermissions(["clipboard-read","clipboard-write"], { origin: "https://www.tradingview.com" }); console.log("grantPermissions ok"); }
catch (e) { console.log("grantPermissions failed:", e.message.split("\n")[0]); }
await page.click('[data-name="pine-dialog"] .monaco-editor .view-lines');
let wrote = true;
try { await page.evaluate(t => navigator.clipboard.writeText(t), SRC); } catch (e) { wrote = false; console.log("clipboard write failed:", e.message.split("\n")[0]); }
if (wrote) {
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Control+V");
  await page.waitForTimeout(600);
  const after = await lines();
  const expected = SRC.split("\n").slice(0,-1);
  console.log("paste exact match:", JSON.stringify(after.slice(0, expected.length)) === JSON.stringify(expected));
  console.log("after:", JSON.stringify(after));
  // readback via clipboard
  await page.keyboard.press("Control+A"); await page.keyboard.press("Control+C");
  const rb = await page.evaluate(() => navigator.clipboard.readText()).catch(e => "ERR " + e.message.split("\n")[0]);
  console.log("readback equals source:", rb === SRC, "| len", rb.length, "vs", SRC.length);
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(3000);
  const panel = await page.evaluate(() => document.querySelector('[data-name="pine-dialog"]').innerText);
  console.log("---- console tail ----\n" + panel.slice(panel.indexOf("problem") - 20).slice(0, 600));
}
await browser.close();
