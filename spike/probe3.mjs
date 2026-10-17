import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find(p => p.url().includes("tradingview.com/chart"));
const lines = () => page.evaluate(() => [...document.querySelectorAll('[data-name="pine-dialog"] .view-line')].map(l => l.textContent.replace(/ /g," ")));
const before = await lines();
console.log("editor before: " + before.length + " lines");
const looksBlank = before.length <= 8 && before.some(l => l.includes("My script")) && before.some(l => l.trim() === "plot(close)");
if (!looksBlank) { console.log("ABORT: editor does not look like a blank scratch indicator"); process.exit(2); }

const SRC = `//@version=6
indicator("Spike test", overlay=true)
f(x) =>
    y = x * 2
    y
plot(f(close) +)
`;
await page.click('[data-name="pine-dialog"] .monaco-editor .view-lines');
await page.keyboard.press("Control+A");
await page.keyboard.insertText(SRC);
await page.waitForTimeout(500);
const after = await lines();
console.log("editor after :", JSON.stringify(after));
const expected = SRC.split("\n").slice(0,-1);
console.log("insertText exact match:", JSON.stringify(after.filter(l=>l!==undefined).slice(0,expected.length)) === JSON.stringify(expected));

await page.keyboard.press("Control+Enter");
await page.waitForTimeout(4000);
const panel = await page.evaluate(() => document.querySelector('[data-name="pine-dialog"]').innerText);
console.log("---- panel innerText (tail) ----\n" + panel.slice(-1500));
await page.screenshot({ path: "probe3.png" });
await browser.close();
