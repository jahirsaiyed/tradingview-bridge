> The throwaway probe scripts were removed after these findings were recorded; see the git history before this commit for them.

# Spike findings (2026-10-17)

Method: Playwright `connectOverCDP` to a dedicated Chrome profile on 127.0.0.1:9222, logged in to TradingView.

## Works
- **Write source**: clipboard paste (`Ctrl+A`, `Ctrl+V`) is exact. `keyboard.insertText` corrupts indentation (Monaco auto-indent). `window.monaco` is not exposed.
- **Read source back**: Monaco only renders visible lines; use select-all + copy and normalise `\r\n`. Rendered spaces are U+00A0.
- **Compile/add**: `Ctrl+Enter`. Takes ~1s. Console lines (timestamped): `Compiling...`, `Compiled.`, `Added to chart.` (first add) / `Updated on chart.` (re-run), `Error at L:C <msg>`. Problems list carries codes (e.g. CE10156).
- **Strategy report**: renders "Key stats" (Total PnL, Max drawdown, Profitable trades, Profit factor). Label is `Total PnL`, not `Total P&L`. Tabs have stable ids: `Strategy report`, `List of Trades`, plus `strategy-report-summary`, `periodical-tab`, `benchmarking-tab`, `margin-tab`, `growth-and-decline-tab`, `streaks-tab`, `time-pattern-tab`.
- **Trade list**: rows readable (number, type, date/time, price, size, net PnL, return). Uses Unicode minus.
- **Pine logs**: `log.info` output is readable per bar with ISO timestamp. `{0}` rounds (1.124); format explicitly for precision.

## Hazards
- **Runtime errors are NOT in the console.** A script that compiles but fails at runtime shows only a red "!" badge on the chart legend and an editor squiggle. Pine logs show "No data". Compile check must inspect the badge (hover for text).
- **Layout modes differ.** Overlay: container `[data-name="pine-dialog"]`. After "Move editor to split-view": container `#pine-editor-dialog`, chart pane is squeezed. Selector map must handle both (or normalise to one mode).
- **Pine logs needs split-view.** Opening it from `More` shows a "Split the view?" dialog; accepting changes layout.
- **Strategy Tester can stall.** First run showed an endless spinner (AAPL layout with other indicators); a manual page reload fixed it. Needs timeout + reload-once recovery.
- **Mis-click risk.** `More` menu items are not `role="menuitem"`; clicking the "Pine logs" label's centre hit the `?` help icon and opened the Help Center. Click by row/left edge and verify the expected panel appeared. Escape did not close the Help overlay; its X button did.
- **Most toolbar buttons lack aria-label/title/data-name.** Prefer keyboard shortcuts and stable ids.
- **Existing chart state is user-owned.** Chart had other indicators; remove only the script we added.
- Page reload (or layout change) resets panels; verify state before every operation.

## Unverified
- Hover tooltip text of the runtime-error "!" badge.
- Behavior with a strategy that has zero trades; non-default timeframes/date ranges.
- Whether split-view/layout changes persist to the user's saved layout.

## Addendum (legend hooks, verified 2026-10-17)
- Legend rows: `[data-qa-id="legend-source-item"]` containing `[data-qa-id~="legend-source-title"]` (script name), actions `legend-show-hide-action`, `legend-settings-action`, `legend-pine-action` (title "Source code"), `legend-delete-action` (title "Remove"), `legend-more-action`.
- **Runtime error is readable**: `[data-qa-id="legend-source-item-status"]` inside the row has `title="Runtime error: RE10045 · Opened in Pine Editor"` (code + message). No hover needed.
- Indicators without `overlay=true` get their own lower pane; each pane has its own collapsible legend. A collapsed legend leaves the row in the DOM but covered by a canvas (`pane-top-canvas`), so Playwright reports it "visible" but hover/click time out.
- **Removal**: a synthetic DOM `.click()` does NOT remove. A real Playwright `locator.click()` on `legend-delete-action` works once the row's legend is expanded (row disappears within ~500 ms). Expand the pane legend first (its arrow button), then click, then poll until the row is gone.
- Page-level: main legend collapse/expand arrow sits at the legend's bottom-left; the label shows the count of hidden items.
