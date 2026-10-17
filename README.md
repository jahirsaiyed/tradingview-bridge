# TradingView Bridge

MCP server that lets Claude write a Pine Script into TradingView, compile it, and verify the result
(compile errors, runtime errors, Strategy Tester stats and trades, Pine logs, screenshots).

## Setup

1. `npm ci` (installs the exact versions pinned in `package-lock.json`)
2. Start the dedicated Chrome (once per session) and log in to TradingView in it:
   `powershell -File scripts\launch-chrome.ps1`
   The bridge attaches to this Chrome over CDP, so it needs this dedicated, logged-in profile: a regular
   Chrome window without the debugging port will not work. Use the window for TradingView only: the
   debugging port gives full control of the profile.
3. Open a **scratch** script in the Pine Editor. `tv_set_script` replaces the editor contents, but refuses
   (`EDITOR_NOT_SCRATCH`) to overwrite a script the bridge did not write unless `overwriteExisting: true`.
4. Register the server with Claude Code, replacing `<path-to-repo>` with the absolute path of this checkout
   (forward slashes work on Windows too):
   `claude mcp add tradingview -- node <path-to-repo>/node_modules/tsx/dist/cli.mjs <path-to-repo>/src/server.ts`
   Example: `claude mcp add tradingview -- node C:/src/tradingview-bridge/node_modules/tsx/dist/cli.mjs C:/src/tradingview-bridge/src/server.ts`
   This runs the project's own pinned `tsx` copy; avoid `npx tsx`, which can download an unpinned package.

The server connects to Chrome lazily, on the first tool call, so it starts even when Chrome is not running.

## Tools

`tv_status`, `tv_open_chart`, `tv_set_script`, `tv_get_script`, `tv_compile`, `tv_screenshot`,
`tv_read_pine_logs`, `tv_read_strategy_stats`, `tv_remove_script`, `tv_selftest`.

Every tool returns JSON with `ok: true` plus its data, or `ok: false` with `error.code` and `error.message`.
`tv_screenshot` returns a PNG image.

Error codes: `NOT_CONNECTED`, `NOT_LOGGED_IN`, `NO_CHART`, `UNEXPECTED_DIALOG`, `LAYOUT_FAILED`,
`TIMEOUT_COMPILE`, `TIMEOUT_REPORT`, `FOREIGN_REPORT`, `SESSION_DISCONNECTED`, `SELECTOR_MISSING`,
`PASTE_MISMATCH`, `EDITOR_NOT_SCRATCH`, `NOT_OWNED`, `INVALID_ARGUMENT`, `REMOVE_FAILED`, `INTERNAL`.

### `tv_set_script`

Replaces the editor contents (clipboard paste, verified by read-back). Tool calls are serialized, so parallel
calls cannot interleave their clipboard use. Before pasting, the bridge reads the editor: it only replaces an
empty editor, text it pasted itself in this session, or TradingView's pristine new-script template. Anything
else (for example one of your saved scripts that TradingView restored after a reload) fails with
`EDITOR_NOT_SCRATCH`. Pass `overwriteExisting: true` only after the owner confirms that script may be replaced.
When the editor contents cannot be read, `tv_set_script` also refuses with `EDITOR_NOT_SCRATCH` (it never
assumes the editor is empty). The pristine templates are `indicator("My script")` + `plot(close)` and a single
`strategy("My strategy")` or `strategy("My strategy", overlay=true, margin_long=100, margin_short=100)` line,
optionally under the license header and `//@version=N`; any other line, including any other comment, counts as
user content. TradingView's real multi-line new-strategy template is therefore probably not treated as
pristine: use `overwriteExisting: true` after confirming with the owner.

### `tv_compile` result fields

- `compiled`: `false` means compile errors (listed in `errors` with line, column and code). For an
  `unchanged` source nothing is compiled, so `compiled` reflects the last real compile of that exact source in
  this session: after a failed compile it stays `false` and the remembered `errors` are returned again. With
  no remembered compile for it (for example after `tv_open_chart`, `tv_remove_script`, a reload recovery or a
  new MCP session), `compiled` is `true` only when the bridge's owned legend row is on the chart; otherwise
  the result is `compiled: false, unchanged: true, unknownState: true` (the bridge cannot tell whether that
  source compiles: change the source and compile again, or ask the owner).
- `warnings`: compiler warnings. Best effort, unverified: the `Warning at L:C` console format has never been
  observed live, so an empty `warnings` list does not prove there were none.
- `runtimeError`: a runtime error detected after the script settles on the chart.
- `unchanged`: `true` when the source already matches the chart, so nothing is recompiled. The bridge then
  reads the status of the legend row it owns again (after waiting, up to 10 s, until the row is not
  calculating) and returns it with `runtimeChecked: true`, so a runtime error raised since the last call
  shows up. Without an owned row (or when the row does not settle) the previously read `runtimeError` is
  returned with `runtimeChecked: false`.
- `runtimeChecked`: `false` means the runtime status was NOT read. It does not mean the script is clean.
  `true` is a point-in-time read: after the compile the bridge waits (up to 10 s) until the script's legend row
  stops calculating and its status badge stays unchanged for 0.7 s (1.5 s when no badge is shown; an empty
  status counts only once the row was seen calculating or 2.5 s after the compile), then reads it. A slow
  script may still raise its error later (for example on a new bar): call `tv_compile` again (an unchanged
  source re-reads the owned row's status, see above) or read Pine logs. If the row does not stop calculating
  within 10 s, `runtimeChecked` is `false`; a runtime error badge that is already shown is still returned in
  `runtimeError`. The readiness signal is TradingView's `data-status="loading"` attribute on the legend row
  (live-verified 2026-10-17); if TradingView drops it, the bridge falls back to the quiet windows and the
  2.5 s rule.
- `cleanedErrorRows`: number of junk "Compilation error" legend rows the bridge removed after a failed compile.

Console pane: compile results are read from the overlay editor's console pane. On a fresh TradingView layout
that pane is collapsed (only a small `>_` button at the bottom-left of the editor). Before reading it the bridge
opens it with one click on that button, waits (up to 3 s) until it is open, and leaves it open afterwards
(every compile needs it). It never clicks the button while the pane is already open or opening. If the button
is missing or the pane does not open, `tv_compile` fails with `SELECTOR_MISSING` (`details.selector`,
`details.reason`: `missing` or `not-opened`) telling the owner to open the console pane, instead of timing out.

Time budget: the whole `tv_compile` call (editor layout, compile, finding and settling the owned row, including
re-picks) shares one 45 s budget; each wait uses at most the time left. Once the budget is used up the call fails
with `TIMEOUT_COMPILE` (`details.reason: "deadline"`, `details.phase`: `outcome`, `error-rows`, `owned-row`,
`row-settle` or `unchanged-settle`) instead of running past about a minute, the usual MCP client timeout. When
the compile itself already ran, `details.action` and `details.ownedEntityId` say so and the bridge keeps owning
that row (so `tv_remove_script` still works); call `tv_compile` again to read the result.

### `tv_read_pine_logs`

Returns `lines` (`time`, `text`) and `layoutRestored`. It briefly switches the editor to split view to open
the Pine logs pane and then back to overlay; `layoutRestored: false` means the overlay could not be restored.
At most the last 500 lines are returned, each `text` cut to 2000 characters. `lines: []` means the pane
rendered with no output; if the pane does not render within 8 s the call fails with `TIMEOUT_REPORT`
(after restoring the layout).

### `tv_read_strategy_stats`

Returns `keyStats` and, with `includeTrades: true`, up to `tradeLimit` recent `trades`. The trade table is
virtualized, so only rendered rows can be read: `tradesTotal` is the closed-trade count from the key stats
(`null` when unknown) and `tradesTruncated: true` means fewer trades were returned than
`min(tradeLimit, tradesTotal)`.

Numbers are parsed only in unambiguous formats: an optional sign, digits with no separators or with proper
comma groups (`1,234,567.89`), an optional `.digits` part and an optional K/M/B magnitude. A value in any other
format (a decimal comma such as `12,5`, `1.234,56`, `1 234,56`, `1,2,3`) is returned as `null` for that key
stat, and a trade row with such a price, size or PnL counts in `unparsedTradeRows`: never a plausible but wrong
number. Plain numbers keep full precision.

The result also names the report: `strategyName` is the strategy the Strategy Tester shows (its footer tab;
TradingView shows the short title when one is declared) and `matchesOwnedScript` is `true`/`false` when both
that name and the script the bridge set are known (`null` otherwise). The names are compared for equality
after normalizing spaces and case (a name shown truncated with an ellipsis matches a script name starting with
the shown text); the footer shows no inputs, so "Name v2" does not match "Name". When the Strategy Tester shows another
strategy (for example one of the owner's), the call fails with `FOREIGN_REPORT` and returns no numbers.
Key stats are read only from the report's Key stats block; trades only from the report container (if the Key
stats block is shown but that container is not found, the call fails with `SELECTOR_MISSING` instead of
returning no trades). Before reading, the bridge waits (up to 15 s) until
its own strategy's legend row stops recalculating, then requires two identical key-stats reads 0.7 s apart.
TradingView updates the numbers while the row is still calculating, so stats right after a recompile are
best-effort until the numbers stop changing; key stats that keep changing for 15 s fail with `TIMEOUT_REPORT`
(`details.reason: "not-settled"`, no reload).

If the report does not render (a zero-trade strategy, or a stalled Strategy
Tester) the call fails with `TIMEOUT_REPORT`. With `allowReload: true` (default `false`) it instead reloads
the page, which drops unsaved chart state, re-applies the script and retries once.

Time budget: one call shares a 50 s budget (without it the waits could add up to about 67 s: row settle 15 s,
render 30 s, stable reads 15 s, strategy name 2 s, trades 5 s); each wait uses at most the time left. Once it is
used up the call fails with `TIMEOUT_REPORT` (`details.reason: "deadline"`, `details.phase`: `row-settle`,
`report-render`, `report-stable`, `strategy-name` or `trades`) instead of running past about a minute; such a
timeout never triggers a reload, even with `allowReload: true`. With `allowReload: true`, the reload recovery
(reload, re-paste, re-compile with its own 45 s budget) is followed by a second read with a fresh 50 s budget,
so such a call can take several minutes in the worst case and may outlast a 60 s client timeout.

### `tv_selftest`

Checks the selectors the bridge depends on. If the overlay editor cannot be opened, the result carries
`layoutError` and the selectors are still checked (required ones then appear in `failures`). `console` is the
state of the editor's console pane (`open`, `collapsed` or `missing`); the selftest only reports it, a
collapsed pane is opened by `tv_compile` itself. The required `consolePane` check fails when neither the pane
nor its toggle exists.

### `tv_open_chart`

Navigates to a symbol and/or interval by reloading the page. The reload closes the Pine Editor and drops
unsaved chart contents. Other tools can be called right afterwards, because the editor-using tools
(`tv_set_script`, `tv_get_script`, `tv_compile`, `tv_screenshot`, `tv_read_strategy_stats`,
`tv_read_pine_logs`, `tv_remove_script`, `tv_selftest`) re-establish the overlay editor layout, reopening the
editor if needed (`tv_read_pine_logs` passes through split view and ends in overlay). `tv_status` only
reports the current layout. Every tool except `tv_status` fails with `NOT_LOGGED_IN` when TradingView shows
its sign-in button, and with `SESSION_DISCONNECTED` when it shows the "Session disconnected" modal (see below);
`tv_status` reports the latter as `sessionDisconnected: true` instead of failing.

### `tv_read_pine_logs` and the Help Center

The Pine logs entry of the editor's More menu has a "?" help icon. If a click lands on it, TradingView opens
its Help Center overlay (Escape does not close it). The bridge then closes it with the overlay's own Close
button and fails with `UNEXPECTED_DIALOG` (`details.closed` says whether it is gone); retry the call.

Not implemented yet: `tv_set_inputs`, `tv_read_data_window` (edit `input.*` defaults in the source
and use `log.info` + `tv_read_pine_logs` instead).

## One TradingView session at a time

TradingView allows one active session per account. When the account is opened on another browser or device,
the dedicated Chrome shows a full-page "Session disconnected" modal and nothing else works. The bridge detects
it (page text "Session disconnected" plus "accessed from another browser or device"; the Pine Editor, Pine
logs, Strategy Tester and chart legends are not checked, so a script or log line quoting these words does not
trigger it): `tv_status` returns
`sessionDisconnected: true` and every other tool fails with `SESSION_DISCONNECTED`. To continue, click Connect
in the dedicated Chrome window yourself; this ends the other session. The bridge never clicks it.

## Safety

- The CDP endpoint must be loopback (`TV_CDP_ENDPOINT`, default `http://127.0.0.1:9222`).
- The bridge never touches alerts, orders, watchlists or drawings. Removal is ownership-guarded: it only removes
  the legend row it added itself in this session (by entity id). `tv_set_script` is guarded by the scratch check
  above, with an explicit `overwriteExisting` override for when the owner confirms.
- It only drives an `https://*.tradingview.com/chart` tab; any other page is refused (`NO_CHART`).
- Editor reads and writes go through the clipboard: the bridge temporarily uses it and restores the previous
  text content afterwards (images or files on the clipboard are not preserved), then clears the clipboard
  permissions it granted. Text you copy while a tool call is running may be overwritten by that restore.
- Clearing the permissions resets ALL permission overrides of the dedicated browser context, not only the
  clipboard ones; this is acceptable because the profile is used for TradingView automation only.
- Review TradingView's terms on automated access before relying on this.

## Development

`npm test` (unit), `npm run test:coverage`, `npm run typecheck`.
Live smoke (needs the logged-in Chrome and a scratch editor):
`set TV_SMOKE_OVERWRITE_EDITOR=1` then `npm run smoke -- all` or `npm run smoke -- driver` (several sections
can run in one process: `npm run smoke -- compile remove`). The `all` run records the legend rows (entity id and
title) at the start and checks at the end that exactly the same rows are present, so it works on any layout,
including the bare default chart: no smoke row left, no other row removed, no row's script replaced.
The editor must hold a scratch script that is not already on the chart: TradingView applies a compile to the
row the editor's script is linked to ("Update on chart"), even a row the bridge did not add.
Only one process may drive the dedicated Chrome at a time: the driver serializes calls within its own process
only, so a smoke run next to an MCP server (or another tool using the bridge) interleaves editor and clipboard
actions.
Spike evidence and UI findings: `spike/FINDINGS.md` (the probe scripts were removed; see git history).
