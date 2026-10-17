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
  'lines, each text cut to 2000 characters; lines=[] means the logs pane rendered with no output. Fails with ' +
  'TIMEOUT_REPORT if the logs pane did not render within 8 s. Format floats explicitly in the script, e.g. ' +
  'str.tostring(x, "#.#####"), since {0} rounds.';

const COMPILE_DESCRIPTION =
  'Compile and add/update the script on the chart. Returns compile errors (line/column/code), warnings, ' +
  'and any runtime error detected after the script settles. compiled=false means errors. ' +
  'unchanged=true means the source already matched the chart, so recompiling is a no-op: the previous ' +
  'runtimeError is returned with runtimeChecked:false. runtimeChecked=false means the runtime status was NOT read, ' +
  'not that the script is clean. cleanedErrorRows is the number of junk "Compilation error" legend rows ' +
  'the bridge removed after a failed compile. ' +
  'warnings are best effort and unverified (their console format has never been observed live): an empty ' +
  'warnings list does not prove there were none.';

const SET_SCRIPT_DESCRIPTION =
  'REPLACES the Pine Editor contents with the given source (clipboard paste, verified by read-back). ' +
  'Refuses with EDITOR_NOT_SCRATCH to overwrite a script the bridge did not write in this session (only an ' +
  'empty editor, text the bridge pasted, or the new-script template are replaced) unless overwriteExisting ' +
  'is true. Set overwriteExisting only after the owner confirms the current script may be replaced; ' +
  'otherwise ask the owner to open a scratch script.';

const STRATEGY_STATS_DESCRIPTION =
  'Read Strategy Tester key stats (Total PnL, Max drawdown, Profitable trades, Profit factor) and optionally ' +
  'the most recent trades. The trade list is virtualized: only rendered rows can be read; tradesTotal is the ' +
  'closed-trade count and tradesTruncated=true means fewer trades were returned than min(tradeLimit, tradesTotal). ' +
  'If the report does not render (e.g. zero trades, or a stalled Strategy Tester) the call fails with ' +
  'TIMEOUT_REPORT. allowReload: true (default false) then reloads the page, which drops unsaved chart state ' +
  'and can take up to a minute, re-applies the script and retries once. Re-check tuned inputs on a different ' +
  'symbol or date range before trusting them.';

const SELFTEST_DESCRIPTION =
  'Check that the selectors this bridge depends on still resolve in the current TradingView UI. If the ' +
  'overlay editor cannot be opened, layoutError says why and the selectors are still checked.';

function registerSessionTools(server: McpServer, getDriver: GetDriver): void {
  server.tool(
    'tv_status',
    'Check the browser connection, login, open chart (symbol, interval) and editor layout (overlay/split/closed).',
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
