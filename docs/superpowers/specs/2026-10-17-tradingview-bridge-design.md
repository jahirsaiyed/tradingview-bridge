# TradingView Bridge: design

Status: draft for review. Evidence base: `spike/FINDINGS.md` (live probes against TradingView on 2026-10-17).

## 1. Goal

Let Claude (via Claude Code) write a Pine Script into TradingView's Pine Editor, compile it, and verify the result in the real browser: compile errors, runtime errors, chart visuals, Strategy Tester stats and trades, and per-bar values. Claude then fixes the script and repeats.

## 2. Scope

**In scope (autonomous actions):** edit the Pine Editor, save, add/update/remove *the script Claude added*, change that script's inputs, change symbol/timeframe, take screenshots, read stats/logs.

**Out of scope, by construction (no code path exists):** alerts, orders/trading/broker panels, watchlists, drawings, publishing scripts, removing indicators Claude did not add.

**Guarded, not impossible:** removal is ownership-guarded (only the legend row the bridge itself added in this session, by entity id). `tv_set_script` replaces the editor contents only when they are scratch (empty, text the bridge pasted in this session, or the pristine new-script template); any other script is refused with `EDITOR_NOT_SCRATCH` unless the caller passes `overwriteExisting: true`, which Claude must only do after the owner confirms.

**Non-goals:** a general TradingView automation library; running unattended; multi-user use; the Chrome-extension driver (kept possible, not designed now).

## 3. Architecture

```
Claude Code --stdio MCP--> MCP server (Node/TS, src/server.ts)
                               |
                          Driver (src/driver/)  -- Playwright connectOverCDP
                               |                    to dedicated Chrome on 127.0.0.1:9222
                          selectors.ts (per layout) + parsers/ (pure functions)
```

- **Dedicated Chrome profile**, launched by `scripts/launch-chrome.ps1` with `--remote-debugging-port=9222 --remote-debugging-address=127.0.0.1` and its own `--user-data-dir`. The user logs in to TradingView once. The profile is used for TradingView only (the CDP port gives full control of that browser).
- **MCP server** exposes tools and validates arguments; it holds no TradingView knowledge.
- **Driver** owns page interaction: layout management, waits, clicks, clipboard paste. Tool handlers call the driver, never Playwright directly. The boundary stays thin; no abstraction is built for a second driver until one exists.
- **selectors.ts** holds every selector, keyed by layout mode. **parsers/** turn DOM text into typed data and contain no I/O.

## 4. Tools

All return `{ok: true, ...}` or `{ok: false, error: {code, message, details}}`. None blocks indefinitely.

| Tool | Behavior |
|---|---|
| `tv_status` | Connected? logged in? chart open? Returns symbol, timeframe, layout mode (`overlay`/`split`), editor open, and `sessionDisconnected` (TradingView's "Session disconnected" modal is shown; never throws for it). |
| `tv_open_chart` | Set symbol and/or timeframe. |
| `tv_set_script` | Paste source into the editor (clipboard). Verifies by reading back. Refuses with `EDITOR_NOT_SCRATCH` when the editor holds a script the bridge did not write (scratch check: empty, text pasted by the bridge this session, or the new-script template) unless `overwriteExisting: true` (only after the owner confirms). An unreadable editor is also refused (`EDITOR_NOT_SCRATCH`). Pristine template: `indicator("My script")` + `plot(close)`, or one exact `strategy("My strategy")` / `strategy("My strategy", overlay=true, margin_long=100, margin_short=100)` line, optionally under the license header and `//@version=N`; any other comment is user content. TradingView's real multi-line new-strategy template is probably not treated as pristine: use `overwriteExisting: true` after confirming with the owner. |
| `tv_get_script` | Read the editor source (select-all + copy; normalises `\r\n`). |
| `tv_compile` | Trigger compile/add (`Ctrl+Enter`). Returns `{compiled, action: "added"|"updated", errors[{line,column,message,code?}], warnings[], runtimeError: {present, code?, raw?}}` (`compiled` is false when there are errors; the tool-level `ok` means the call itself worked). `runtimeChecked: true` is a point-in-time read taken once the owned legend row stopped calculating (`data-status="loading"` cleared, status unchanged for 0.7 s, 1.5 s when empty, and an empty status only after loading was seen or 2.5 s after the trigger; bounded 10 s); a slow script may raise its error later. With `unchanged: true` the owned row's status is read again the same way (no trigger, so the 2.5 s rule is already met) and returned with `runtimeChecked: true`; without an owned row or when it does not settle, the cached `runtimeError` is returned with `runtimeChecked: false`. With `unchanged: true`, `compiled` is the remembered outcome of the last real compile of that exact source in this session (after a failed compile: `compiled: false` plus the remembered errors); the memory is keyed by the exact source, so setting another source does not forget it; it is cleared by `tv_open_chart`, `tv_remove_script` and the reload recovery; a compile that fails after it was triggered marks a different source's outcome unknown (a failure before the trigger changes nothing). With no usable memory, `compiled: true` only when the owned row is on the chart and its status does not start with `Compilation error`, else `compiled: false, unknownState: true`. TradingView's reply `There is nothing to update.` (it refuses to recompile its last compiled text) is reported as `unchanged`. The whole call shares a 45 s deadline (each wait and each click/hover is capped by the time left, never a 0 ms Playwright timeout, which would mean no timeout); once it is used up it fails with `TIMEOUT_COMPILE` (`details.reason: "deadline"`, `details.phase`). Phase `before-trigger`: less than 20 s were left before Ctrl+Enter, nothing compiled. Phase `outcome`: triggered but unread, no row claimed. Later phases carry `details.action`/`details.ownedEntityId` and the bridge keeps owning that row. |
| `tv_set_inputs` | **Deferred** (see section 10). Set input values of the script Claude added, from a name-to-value map. |
| `tv_screenshot` | Chart screenshot. Ensures overlay layout first so the chart is wide. |
| `tv_read_pine_logs` | Per-bar `log.*` output as `[{time, text}]` (level markup not yet observed). Switches to split layout, reads, returns to overlay. An empty result carries an `emptyHint` (e.g. the `barstate.islast` live-bar trap and the `barstate.islastconfirmedhistory` remedy). |
| `tv_read_strategy_stats` | Key stats parsed into numbers with units (Total PnL, Max drawdown, Profitable trades, Profit factor), plus optionally the trade list (default last 50 rows; only rendered rows of the virtualized table can be read: `tradesTotal` and `tradesTruncated` report it). Reads only the Key stats block (`[data-qa-id="strategy-key-facts"]`) and trade rows inside the report container; returns `strategyName` (the Strategy Tester footer tab) and `matchesOwnedScript` (normalized equality with the owned script's title/short title, an ellipsis-truncated shown name matching by prefix; `null` when either is unknown); a missing trades container while Key stats are shown is `SELECTOR_MISSING` and fails with `FOREIGN_REPORT` when another strategy is shown. Waits (bounded 15 s) for the owned row to stop recalculating, then requires two identical key-stats reads 0.7 s apart; stats right after a recompile are best-effort until the numbers stop changing. `allowReload` (default false): on `TIMEOUT_REPORT`, reload the page (drops unsaved chart state), re-apply the script and retry once; without it the timeout is returned as is. One call shares a 50 s deadline (each wait is capped by the time left); once it is used up it fails with `TIMEOUT_REPORT` (`details.reason: "deadline"`, `details.phase`), never followed by a reload. With `allowReload` the read after the reload recovery gets a fresh 50 s deadline, so such a call can take several minutes. |
| `tv_read_data_window` | **Deferred** (see section 10). Indicator values at the latest bar only (per-bar reads go through Pine logs). |
| `tv_remove_script` | Remove only the script Claude added in this session. |
| `tv_selftest` | Check every selector in the current layout resolves and key labels still match; report failures by name. Includes the required `consolePane` check (the console pane or its toggle exists) and reports `console: open|collapsed|missing` without opening it. |

## 5. Verify loop (guidance to Claude, not enforced)

1. `tv_set_script` then `tv_compile`.
2. Errors present: fix and repeat. Stop and report after 5 attempts.
3. Compiled: check `runtime_error`, then `tv_screenshot`; for numeric checks add `log.info` with explicit formatting (e.g. `str.tostring(x, "#.#####")`, since `{0}` rounds) and call `tv_read_pine_logs`.
4. Strategies: `tv_read_strategy_stats`. Any input tuning must be re-checked on a different symbol or date range and both results reported (guards against curve-fitting). Cap tuning iterations.

## 6. Key behaviors and rules (each backed by a spike result)

- **Writing source:** clipboard paste only. `insertText`/typing corrupts indentation via Monaco auto-indent. `window.monaco` is not exposed.
- **Staleness:** record the console line count before triggering compile; accept a result only from lines after the trigger. `Added to chart.` vs `Updated on chart.` distinguishes first add from re-run.
- **Runtime errors are not in the console.** After a compile, wait until the script's legend row no longer has `data-status="loading"` and its status badge is unchanged for 0.7 s (1.5 s when no badge, and an empty status only after loading was seen or 2.5 s after the trigger; bounded 10 s; a first add briefly shows a transient row with another entity id, so a row that disappears while settling or is gone right after it is re-picked, at most 3 picks), then read `[data-qa-id="legend-source-item-status"]` inside the script's legend row; its `title` is e.g. `Runtime error: RE10045 · Opened in Pine Editor` (the error code plus a UI hint; the underlying message text is not in the title; no hover needed). Pine logs show "No data" in that case.
- **Layouts:** overlay container `[data-name="pine-dialog"]`; split container `#pine-editor-dialog`. Every tool first calls `ensureLayout(required)`. The toggle is the button titled "Move split-view to overlay" or "Move overlay to split-view". Pine logs requires split (TradingView shows a "Split the view?" dialog, accepted only when we initiated it). Screenshots require overlay.
- **Stable hooks:** Strategy Tester `role="tab"` ids (`Strategy report`, `List of Trades`, ...). Most toolbar buttons are unlabeled; prefer keyboard shortcuts and scoped locators.
- **Readiness and recovery:** every wait has an explicit condition and timeout. If the Strategy Tester shows a spinner past the timeout (observed once; fixed by page reload), return `TIMEOUT_REPORT` (the report may also be empty for a zero-trade strategy). Only when the caller passed `allowReload: true`: reload once, re-establish layout, re-apply the script (scratch check applies), retry once, then return `TIMEOUT_REPORT`. A re-compile with an unknown state (unchanged source, row re-created with a new id) is accepted only while a legend row matching the script names is on the chart; ownership is never taken by title.
- **Parsing:** Unicode minus (U+2212), thousands separators, `USD` suffixes, `%` values, and U+00A0 in rendered editor text are all handled in parsers. Numbers are accepted only in unambiguous formats: optional sign, digits with no separators or proper comma groups (`1,234,567`), optional `.digits`, optional K/M/B. A decimal comma (`12,5`), European or space grouping (`1.234,56`, `1 234,56`) or stray commas (`1,2,3`) parse as `null` (that key-stats field is `null`; a trade row with such a required number counts as unparsed), never as a plausible wrong number. Plain numbers keep full double precision (only K/M/B products are rounded to 15 significant digits to drop floating-point noise).
- **Removal safety:** `tv_remove_script` locates the `legend-source-item` row whose `legend-source-title` equals the script Claude added, expands that pane's legend if collapsed (a collapsed legend is covered by a canvas and blocks pointer events), clicks the row's `legend-delete-action` with a real Playwright click (a synthetic DOM `.click()` does not remove), then polls until the row is gone. Indicators without `overlay=true` live in their own lower pane with their own legend. Never use positional clicks on the chart.
- **Help Center:** a misclick on the Pine logs "?" icon opens `[data-name="support-dialog"]`; Escape does not close it. Close it with its own "Close" button (bounded wait until hidden) and return `UNEXPECTED_DIALOG` with `details.closed`.
- **One session:** TradingView allows one active session; a "Session disconnected" modal appears when the account is opened elsewhere. Every tool except `tv_status` checks the page text (excluding the Pine Editor, Pine logs, Strategy Tester and legends) first and fails with `SESSION_DISCONNECTED`; the bridge never clicks Connect (that ends the other session).
- **Console pane:** compile results come from the overlay editor's console pane, which is collapsed on a fresh layout (its lines are then not in the rendered text). Before the baseline read the bridge clicks the toggle once (`[class*="consoleButtonWrapper-"] button`, `data-active`/`data-tooltip` "Open console"/"Close console"), waits up to 3 s until the pane has a height, and leaves it open. It never clicks a toggle that is already active. A missing, unclickable or non-opening toggle fails with `SELECTOR_MISSING` (`details.reason`) telling the owner to open the pane, instead of a compile timeout.
- **Linked editor (known limitation):** a compile applies to whichever chart row the editor's script is linked to ("Update on chart"), even a row the bridge did not add, so the owner must open a scratch script that is not on the chart. Not detected yet (needs live evidence).
- **One bridge process per Chrome:** `connect()` takes an exclusive lock file per CDP port in the OS temp directory (`{pid, startedAt}`, created with `wx`); a dead holder or a corrupt file is taken over, a live holder makes the call fail with `BRIDGE_BUSY`; released on exit/SIGINT/SIGTERM and when a first connect fails. `TV_ALLOW_SHARED_CHROME=1` skips it.
- **Never right-click the chart or click blind coordinates.** The chart context menu contains alert and order entries.

## 7. Errors

Typed codes: `NOT_CONNECTED`, `NOT_LOGGED_IN`, `NO_CHART`, `UNEXPECTED_DIALOG` (includes dialog title; e.g. Help Center, upgrade prompts), `LAYOUT_FAILED`, `TIMEOUT_COMPILE`, `TIMEOUT_REPORT`, `FOREIGN_REPORT` (the Strategy Tester shows another strategy; names it; no numbers returned), `SESSION_DISCONNECTED` (TradingView's one-session modal is shown; the owner must click Connect in the dedicated Chrome, which ends the other session), `SELECTOR_MISSING` (names the selector; also a console pane that cannot be opened), `PASTE_MISMATCH`, `EDITOR_NOT_SCRATCH` (the editor holds a script the bridge did not write; retry with `overwriteExisting: true` only after the owner confirms), `NOT_OWNED` (target script was not added by Claude), `INVALID_ARGUMENT`, `REMOVE_FAILED`, `BRIDGE_BUSY` (another live bridge process holds the lock for this CDP port; names its pid), `INTERNAL` (unexpected exception). A dialog we did not trigger is never auto-accepted.

## 8. Security

CDP bound to `127.0.0.1`; dedicated profile; no secrets stored or logged; tool inputs validated; Pine source is only ever written to the editor. The tool-surface guardrails are soft against a caller with generic shell or Playwright access, so profile isolation is the real boundary. TradingView's terms on automated access are unreviewed; keep use low-frequency, single-session and personal, and review the terms before relying on this.

## 9. Testing

- **Unit:** parsers against saved real-DOM text fixtures (console lines, Key stats, trade rows with Unicode minus, Pine log lines, runtime-error badge). Cover 80%+ of parsers and layout/wait logic via injected fakes.
- **Selector self-test:** `tv_selftest`, run before any build session and in CI-less manual smoke runs.
- **Live smoke script** (manual, needs the logged-in profile): paste, compile OK, compile error, runtime error, read stats, read logs, remove script, restore layout. No fake TradingView server, because it would not catch real UI drift.

## 10. Known risks and unverified items

- UI drift: TradingView ships UI changes; selectors are centralised and self-tested.
- `tv_set_inputs` and `tv_read_data_window` depend on dialog/DOM structure not yet probed; they are deferred to a follow-up plan (Claude can change inputs by editing `input.*` defaults in the source and recompiling, and per-bar values come from Pine logs).
- Zero-trade strategies, non-default timeframes/date ranges, and non-USD symbols are untested.
- Whether layout changes (split-view) persist to the user's saved TradingView layout is unknown.
- First-run stall of the Strategy Tester was resolved only by manual reload; the automated reload-retry is untested.

## 11. Project layout

```
src/server.ts           MCP tools, arg validation
src/driver/             playwright driver, layout manager, waits
src/selectors.ts        selectors per layout
src/parsers/            pure parsing functions
scripts/launch-chrome.ps1
test/parsers/           fixtures + unit tests
test/live-smoke.mjs     manual end-to-end script
spike/FINDINGS.md       spike findings (the throwaway probe scripts were removed; see git history)
```
