import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TvError, toFailure, toResult, type ToolResult } from './result.js';
import type { DriverApi } from './driver/types.js';

export type GetDriver = () => Promise<DriverApi>;

function asText(result: ToolResult<object>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
}

function runTool<T extends object>(getDriver: GetDriver, fn: (driver: DriverApi) => Promise<T>): Promise<CallToolResult> {
  return toResult(async () => fn(await getDriver())).then(asText);
}

const SYMBOL = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:!-]+$/, 'symbol contains invalid characters');
const INTERVAL = z.string().min(1).max(8).regex(/^[A-Za-z0-9]+$/, 'interval must be alphanumeric, e.g. 60, D, W');

const OPEN_CHART_DESCRIPTION =
  'Navigate the chart to a symbol and/or interval (TradingView URL form, e.g. interval "60", "D"). ' +
  'Reloads the page, which closes the Pine Editor (the next tool call reopens it) and drops unsaved chart contents.';

const PINE_LOGS_DESCRIPTION =
  'Read log.info/log.warning/log.error output (per bar, timestamped). Briefly switches the editor to split view ' +
  'and back; layoutRestored=false means the overlay layout could not be restored. Returns at most the last 500 ' +
  'lines, each text cut to 2000 characters; lines=[] means the logs pane rendered with no output, and then ' +
  'emptyHint explains why. Fails with TIMEOUT_REPORT if the logs pane did not render within 8 s. The pane only ' +
  'shows output from executions that have happened and only renders the visible lines. A log.* call guarded by ' +
  'barstate.islast may not run until the live bar closes when the market is open (strategies run on bar close by ' +
  'default), so the pane can stay on "Waiting on logs". To get logs deterministically, log from historical bars: ' +
  'guard with barstate.islastconfirmedhistory (last historical bar) or log on every bar. Format floats explicitly ' +
  'in the script, e.g. str.tostring(x, "#.#####"), since {0} rounds.';

const COMPILE_DESCRIPTION =
  'Compile and add/update the script on the chart. Returns compile errors (line/column/code), warnings, ' +
  'and any runtime error detected after the script settles. compiled=false means errors. ' +
  'runtimeChecked=true is a point-in-time read: the owned legend row stopped calculating (its data-status ' +
  'attribute is no longer "loading") and its status stayed unchanged for 0.7 s (1.5 s when no badge is shown; ' +
  'an empty status counts only after the row was seen calculating or 2.5 s after the compile). A script can ' +
  'still raise its error later (e.g. on a new bar): call tv_compile again or read Pine logs. ' +
  'If the row does not stop calculating within 10 s, runtimeChecked=false and a badge already shown is still returned. ' +
  'unchanged=true means the source already matched the chart, so nothing is recompiled; the bridge then ' +
  "reads the owned row's status again (once it is not loading, bounded 10 s) and returns it with " +
  'runtimeChecked=true. Without an owned row, or when the row does not settle, the previously read ' +
  'runtimeError (if any) is returned with runtimeChecked=false. runtimeChecked=false means the runtime status was NOT read, ' +
  'not that the script is clean. With unchanged=true, compiled reflects the last compile of that exact ' +
  'source in this session (setting another source in between does not forget it): after a failed compile it ' +
  'stays compiled=false and the cached errors are returned. With no usable remembered compile (after ' +
  'tv_open_chart, tv_remove_script, a reload recovery, a new session, a last real compile of another source, ' +
  'or a compile of this source that failed after it was triggered), compiled=true only when the owned row is ' +
  'on the chart and its status is not a compilation error; otherwise ' +
  'compiled=false and unknownState=true (state unknown: change the source or ask the owner). cleanedErrorRows is the number of junk "Compilation error" legend rows ' +
  'the bridge removed after a failed compile. ' +
  'warnings are best effort and unverified (their console format has never been observed live): an empty ' +
  'warnings list does not prove there were none. The whole call shares one 45 s time budget: once it is used ' +
  'up the call fails with TIMEOUT_COMPILE (details.reason "deadline", details.phase = the phase reached; ' +
  'details.action and details.ownedEntityId when the compile already ran and its row is known) instead of running ' +
  'past about a minute. Phase before-trigger (less than 20 s left) means nothing was compiled; phase outcome ' +
  'means the compile was triggered but its result was not read and no row is claimed. ' +
  'TradingView\'s reply "There is nothing to update." is reported as unchanged. ' +
  'Results are read from the editor console pane: a collapsed pane is opened (one click) and left open; if it ' +
  'cannot be opened the call fails with SELECTOR_MISSING (ask the owner to open the Pine Editor console pane).';

const SET_SCRIPT_DESCRIPTION =
  'REPLACES the Pine Editor contents with the given source (clipboard paste, verified by read-back). ' +
  'Refuses with EDITOR_NOT_SCRATCH to overwrite a script the bridge did not write in this session (only an ' +
  'empty editor, text the bridge pasted, or the new-script template are replaced) unless overwriteExisting ' +
  'is true. Set overwriteExisting only after the owner confirms the current script may be replaced; ' +
  'otherwise ask the owner to open a scratch script.';

const STRATEGY_STATS_DESCRIPTION =
  'Read Strategy Tester key stats (Total PnL, Max drawdown, Profitable trades, Profit factor) and optionally ' +
  'the most recent trades. strategyName is the strategy the Strategy Tester shows; matchesOwnedScript is ' +
  'true/false when both it and the script the bridge set are known (null otherwise). When the Strategy Tester ' +
  'shows another strategy the call fails with FOREIGN_REPORT and returns no numbers. The bridge first waits ' +
  '(up to 15 s) until its strategy row stops recalculating, then requires two identical key-stats reads 0.7 s ' +
  'apart; numbers right after a recompile are still best-effort until they stop changing. The trade list is virtualized: only rendered rows can be read; tradesTotal is the ' +
  'closed-trade count and tradesTruncated=true means fewer trades were returned than min(tradeLimit, tradesTotal). ' +
  'A number in an ambiguous format (decimal comma such as 12,5 or 1.234,56) is returned as null (a trade row ' +
  'with one counts in unparsedTradeRows), never misread. ' +
  'If the report does not render (e.g. zero trades, or a stalled Strategy Tester) the call fails with ' +
  'TIMEOUT_REPORT. The call shares one 50 s time budget: once it is used up it fails with TIMEOUT_REPORT ' +
  '(details.reason "deadline", details.phase = the phase reached, never a reload) instead of running past about a minute. ' +
  'allowReload: true (default false) reloads the page on a stalled report, which drops unsaved chart state, ' +
  're-applies the script and retries once; the retry gets a fresh 50 s budget, so such a call can take several ' +
  'minutes and may outlast a 60 s client timeout. Re-check tuned inputs on a different ' +
  'symbol or date range before trusting them.';

const SELFTEST_DESCRIPTION =
  'Check that the selectors this bridge depends on still resolve in the current TradingView UI. If the ' +
  'overlay editor cannot be opened, layoutError says why and the selectors are still checked. console is the ' +
  'editor console pane state (open/collapsed/missing); tv_compile opens a collapsed pane itself.';

function registerSessionTools(server: McpServer, getDriver: GetDriver): void {
  server.tool(
    'tv_status',
    'Check the browser connection, login, open chart (symbol, interval) and editor layout (overlay/split/closed). ' +
      'sessionDisconnected=true means TradingView shows "Session disconnected" (account opened elsewhere): ' +
      'every other tool then fails with SESSION_DISCONNECTED until the owner clicks Connect in the dedicated Chrome.',
    {},
    () => runTool(getDriver, (d) => d.status()),
  );

  server.tool(
    'tv_open_chart',
    OPEN_CHART_DESCRIPTION,
    { symbol: SYMBOL.optional(), interval: INTERVAL.optional() },
    (args) =>
      runTool(getDriver, async (d) => {
        if (!args.symbol && !args.interval) {
          throw new TvError('INVALID_ARGUMENT', 'Provide a symbol, an interval, or both');
        }
        return d.openChart(args);
      }),
  );

  server.tool(
    'tv_selftest',
    SELFTEST_DESCRIPTION,
    {},
    () => runTool(getDriver, (d) => d.selftest()),
  );
}

function registerScriptTools(server: McpServer, getDriver: GetDriver): void {
  server.tool(
    'tv_set_script',
    SET_SCRIPT_DESCRIPTION,
    {
      source: z.string().min(1).max(200_000),
      overwriteExisting: z
        .boolean()
        .optional()
        .describe('Replace a script the bridge did not write. Use only after the owner confirms.'),
    },
    (args) => runTool(getDriver, (d) => d.setScript(args.source, { overwriteExisting: args.overwriteExisting })),
  );

  server.tool('tv_get_script', 'Read the current Pine Editor source.', {}, () =>
    runTool(getDriver, (d) => d.getScript()),
  );

  server.tool('tv_compile', COMPILE_DESCRIPTION, {}, () => runTool(getDriver, (d) => d.compile()));

  server.tool(
    'tv_remove_script',
    'Remove the script this bridge added in this session. Never removes other indicators.',
    {},
    () => runTool(getDriver, (d) => d.removeScript()),
  );
}

function registerReadTools(server: McpServer, getDriver: GetDriver): void {
  server.tool('tv_screenshot', 'Screenshot of the TradingView viewport as PNG.', {}, async (): Promise<CallToolResult> => {
    try {
      const { png } = await (await getDriver()).screenshot();
      return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
    } catch (error) {
      return asText(toFailure(error));
    }
  });

  server.tool(
    'tv_read_pine_logs',
    PINE_LOGS_DESCRIPTION,
    {},
    () => runTool(getDriver, (d) => d.readPineLogs()),
  );

  server.tool(
    'tv_read_strategy_stats',
    STRATEGY_STATS_DESCRIPTION,
    {
      includeTrades: z.boolean().default(false),
      tradeLimit: z.number().int().min(1).max(500).default(50),
      allowReload: z
        .boolean()
        .default(false)
        .describe('On TIMEOUT_REPORT, reload the page (drops unsaved chart state) and retry once.'),
    },
    (args) => runTool(getDriver, (d) => d.readStrategyStats(args)),
  );
}

export function registerTools(server: McpServer, getDriver: GetDriver): void {
  registerSessionTools(server, getDriver);
  registerScriptTools(server, getDriver);
  registerReadTools(server, getDriver);
}
