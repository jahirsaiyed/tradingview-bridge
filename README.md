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
`TIMEOUT_COMPILE`, `TIMEOUT_REPORT`, `SELECTOR_MISSING`, `PASTE_MISMATCH`, `EDITOR_NOT_SCRATCH`, `NOT_OWNED`,
`INVALID_ARGUMENT`, `REMOVE_FAILED`, `INTERNAL`.

### `tv_set_script`

Replaces the editor contents (clipboard paste, verified by read-back). Tool calls are serialized, so parallel
calls cannot interleave their clipboard use. Before pasting, the bridge reads the editor: it only replaces an
empty editor, text it pasted itself in this session, or TradingView's pristine new-script template. Anything
else (for example one of your saved scripts that TradingView restored after a reload) fails with
`EDITOR_NOT_SCRATCH`. Pass `overwriteExisting: true` only after the owner confirms that script may be replaced.

### `tv_compile` result fields

- `compiled`: `false` means compile errors (listed in `errors` with line, column and code).
- `warnings`: compiler warnings. Best effort, unverified: the `Warning at L:C` console format has never been
  observed live, so an empty `warnings` list does not prove there were none.
- `runtimeError`: a runtime error detected after the script settles on the chart.
- `unchanged`: `true` when the source already matches the chart. Recompiling identical source is a no-op:
  the previous `runtimeError` is returned with `runtimeChecked: false`.
- `runtimeChecked`: `false` means the runtime status was NOT read. It does not mean the script is clean.
- `cleanedErrorRows`: number of junk "Compilation error" legend rows the bridge removed after a failed compile.

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
`min(tradeLimit, tradesTotal)`. If the report does not render (a zero-trade strategy, or a stalled Strategy
Tester) the call fails with `TIMEOUT_REPORT`. With `allowReload: true` (default `false`) it instead reloads
the page, which drops unsaved chart state and can take up to a minute, re-applies the script and retries once.

### `tv_selftest`

Checks the selectors the bridge depends on. If the overlay editor cannot be opened, the result carries
`layoutError` and the selectors are still checked (required ones then appear in `failures`).

### `tv_open_chart`

Navigates to a symbol and/or interval by reloading the page. The reload closes the Pine Editor and drops
unsaved chart contents. Other tools can be called right afterwards, because the editor-using tools
(`tv_set_script`, `tv_get_script`, `tv_compile`, `tv_screenshot`, `tv_read_strategy_stats`,
`tv_read_pine_logs`, `tv_remove_script`, `tv_selftest`) re-establish the overlay editor layout, reopening the
editor if needed (`tv_read_pine_logs` passes through split view and ends in overlay). `tv_status` only
reports the current layout. Every tool except `tv_status` fails with `NOT_LOGGED_IN` when TradingView shows
its sign-in button.

Not implemented yet: `tv_set_inputs`, `tv_read_data_window` (edit `input.*` defaults in the source
and use `log.info` + `tv_read_pine_logs` instead).

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
`set TV_SMOKE_OVERWRITE_EDITOR=1` then `npm run smoke -- all` or `npm run smoke -- driver`.
Spike evidence and UI findings: `spike/FINDINGS.md` (the probe scripts were removed; see git history).
