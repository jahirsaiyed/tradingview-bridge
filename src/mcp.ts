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
  'the bridge removed after a failed compile.';

export function registerTools(server: McpServer, getDriver: GetDriver): void {
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
    'tv_set_script',
    'REPLACES the Pine Editor contents with the given source (clipboard paste, verified by read-back). Open a scratch script first.',
    { source: z.string().min(1).max(200_000) },
    (args) => runTool(getDriver, (d) => d.setScript(args.source)),
  );

  server.tool('tv_get_script', 'Read the current Pine Editor source.', {}, () =>
    runTool(getDriver, (d) => d.getScript()),
  );

  server.tool('tv_compile', COMPILE_DESCRIPTION, {}, () => runTool(getDriver, (d) => d.compile()));

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
    'Read Strategy Tester key stats (Total PnL, Max drawdown, Profitable trades, Profit factor) and optionally the most recent trades. Re-check tuned inputs on a different symbol or date range before trusting them.',
    {
      includeTrades: z.boolean().default(false),
      tradeLimit: z.number().int().min(1).max(500).default(50),
    },
    (args) => runTool(getDriver, (d) => d.readStrategyStats(args)),
  );

  server.tool(
    'tv_remove_script',
    'Remove the script this bridge added in this session. Never removes other indicators.',
    {},
    () => runTool(getDriver, (d) => d.removeScript()),
  );

  server.tool(
    'tv_selftest',
    'Check that the selectors this bridge depends on still resolve in the current TradingView UI.',
    {},
    () => runTool(getDriver, (d) => d.selftest()),
  );
}
