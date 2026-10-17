// Live smoke test. Needs Chrome from scripts/launch-chrome.ps1, logged in to TradingView.
// Sections that write to the editor replace its contents: open a scratch script first and set
// TV_SMOKE_OVERWRITE_EDITOR=1. Usage: npm run smoke -- <section|all>
import type { Page } from 'playwright-core';
import { connect } from '../src/driver/connection.js';
import { createPageLayoutOps } from '../src/driver/pageLayoutOps.js';
import { ensureLayout } from '../src/driver/layout.js';
import { SOURCES } from './fixtures/pine.js';
import { writeAndVerify } from '../src/driver/editor.js';
import { compileAndCollect } from '../src/driver/compile.js';
import { scriptTitles, sourcesEqual } from '../src/parsers/source.js';
import { listLegendRows, removeLegendRow } from '../src/driver/legend.js';
import { readKeyStats, readReportStrategyName, readTrades } from '../src/driver/strategyReader.js';
import { matchesOwnedScript } from '../src/driver/reportIdentity.js';
import { readPineLogs } from '../src/driver/logsReader.js';
import { TvDriver } from '../src/driver/driver.js';
import { TvError } from '../src/result.js';
import { readChartLabel, isLoggedIn, takeScreenshot } from '../src/driver/chart.js';

type Section = (page: Page) => Promise<void>;

const UNKNOWN_SOURCE = `//@version=6
indicator("TV Bridge Unknown Text")
plot(open)
`;

// tv_set_script must refuse text the bridge did not write, and accept it with overwriteExisting.
async function scratchGuardCheck(page: Page, driver: TvDriver): Promise<void> {
  await writeAndVerify(page, UNKNOWN_SOURCE); // low level: the driver does not know this text
  const refused = await driver.setScript(SOURCES.valid).then(
    () => null,
    (error: unknown) => error,
  );
  check(refused instanceof TvError && refused.code === 'EDITOR_NOT_SCRATCH', 'unknown editor text is refused');
  check(sourcesEqual((await driver.getScript()).source, UNKNOWN_SOURCE), 'refused setScript left the editor untouched');
  await driver.setScript(SOURCES.valid, { overwriteExisting: true });
  check(sourcesEqual((await driver.getScript()).source, SOURCES.valid), 'overwriteExisting replaces the unknown text');
}

// Parallel calls are serialized: no interleaved Ctrl+A/Ctrl+V or clipboard sentinel in the editor.
async function concurrencyCheck(driver: TvDriver): Promise<void> {
  const [first, status, second] = await Promise.all([driver.getScript(), driver.status(), driver.getScript()]);
  check(
    sourcesEqual(first.source, SOURCES.valid) && sourcesEqual(second.source, SOURCES.valid) && status.chartOpen,
    `parallel getScript/status/getScript are consistent (${status.layout})`,
  );
  const after = (await driver.getScript()).source;
  check(sourcesEqual(after, SOURCES.valid) && !after.includes('__tv_bridge_sentinel__'), 'editor text unchanged by parallel calls');
}

export const state: { owned: string | null } = { owned: null };

export function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`SMOKE FAIL: ${message}`);
  console.log(`ok - ${message}`);
}

export function requireOverwriteFlag(): void {
  if (process.env.TV_SMOKE_OVERWRITE_EDITOR !== '1') {
    throw new Error('Refusing to overwrite the editor. Open a scratch script and set TV_SMOKE_OVERWRITE_EDITOR=1.');
  }
}

const sections: Record<string, Section> = {
  layout: async (page) => {
    const ops = createPageLayoutOps(page);
    await ensureLayout(ops, 'overlay');
    check((await ops.detect()) === 'overlay', 'overlay layout reached');
    await ensureLayout(ops, 'split');
    check((await ops.detect()) === 'split', 'split layout reached (Pine logs open)');
    await ensureLayout(ops, 'overlay');
    check((await ops.detect()) === 'overlay', 'overlay layout restored');
  },
  compile: async (page) => {
    requireOverwriteFlag();
    await ensureLayout(createPageLayoutOps(page), 'overlay');
    const titles = scriptTitles(SOURCES.broken);

    await writeAndVerify(page, SOURCES.broken);
    const rowsBeforeBroken = await listLegendRows(page);
    const bad = await compileAndCollect(page, { previousOwned: state.owned, scriptTitles: titles });
    check(bad.errors.length >= 1, 'broken source reports a compile error');
    check(bad.errors[0]!.line === 7, `error is on line 7 (got ${bad.errors[0]!.line})`);
    check(bad.cleanedErrorRows >= 1, `failed compile junk row removed (${bad.cleanedErrorRows})`);
    check(
      (await listLegendRows(page)).length === rowsBeforeBroken.length,
      'failed compile leaves no net legend rows',
    );

    await writeAndVerify(page, SOURCES.valid);
    const good = await compileAndCollect(page, { previousOwned: state.owned, scriptTitles: titles });
    check(good.errors.length === 0 && good.action !== null, `valid source compiles (${good.action})`);
    check(good.runtimeChecked === true, 'valid source legend status was read');
    check(!good.runtimeError.present, 'valid source has no runtime error');
    state.owned = good.ownedEntityId;
    check(state.owned !== null, 'bridge owns the legend row it added');

    await writeAndVerify(page, SOURCES.runtimeError);
    const runtime = await compileAndCollect(page, { previousOwned: state.owned, scriptTitles: titles });
    check(runtime.errors.length === 0, 'runtime-error source compiles');
    check(runtime.runtimeChecked === true, 'runtime-error source legend status was read');
    check(
      runtime.runtimeError.present && /^RE\d+$/.test(runtime.runtimeError.code ?? ''),
      `runtime error detected (${runtime.runtimeError.code})`,
    );
    state.owned = runtime.ownedEntityId;
  },
  remove: async (page) => {
    if (!state.owned) throw new Error("Run the 'compile' section first (it records the owned legend row).");
    const result = await removeLegendRow(page, state.owned);
    check(result.removed, 'owned script removed from the chart');
    const rows = await listLegendRows(page);
    check(!rows.some((row) => row.entityId === state.owned), 'legend no longer lists the removed row');
    const again = await removeLegendRow(page, state.owned);
    check(!again.removed, 'removing again reports row not found instead of failing');
    state.owned = null;
  },
  strategy: async (page) => {
    requireOverwriteFlag();
    await ensureLayout(createPageLayoutOps(page), 'overlay');
    await writeAndVerify(page, SOURCES.strategy);
    const report = await compileAndCollect(page, {
      previousOwned: state.owned,
      scriptTitles: scriptTitles(SOURCES.strategy),
    });
    check(report.errors.length === 0, 'strategy compiles');
    state.owned = report.ownedEntityId;
    const stats = await readKeyStats(page, 45_000);
    console.log(JSON.stringify(stats));
    check(stats.totalPnl !== null, 'Total PnL parsed');
    check(stats.profitFactor !== null, 'Profit factor parsed');
    check(stats.profitableTrades !== null && stats.profitableTrades.total > 0, 'Profitable trades parsed');
    const shown = await readReportStrategyName(page);
    check(shown === 'TV Bridge Smoke', `Strategy Tester names the smoke strategy (${shown})`);
    check(matchesOwnedScript(shown, scriptTitles(SOURCES.strategy)) === true, 'report matches the owned script');
    const second = await readKeyStats(page, 45_000);
    check(JSON.stringify(second) === JSON.stringify(stats), 'two consecutive key stats reads agree');
    const { trades, unparsed } = await readTrades(page, 5);
    check(trades.length > 0, `trade list parsed (${trades.length} rows)`);
    check(unparsed === 0, `no unparsed trade rows (got ${unparsed})`);

    // Strategy Tester is still open here: re-compile and removal must both cope with that.
    const titles = scriptTitles(SOURCES.strategy);
    const same = await compileAndCollect(page, { previousOwned: state.owned, scriptTitles: titles });
    check(same.unchanged && same.errors.length === 0, 'unchanged source is reported as unchanged, not a timeout');
    await writeAndVerify(page, `${SOURCES.strategy}// recompile ${Date.now()}
`);
    const again = await compileAndCollect(page, { previousOwned: state.owned, scriptTitles: titles });
    check(again.errors.length === 0, 're-compile with the tester open has no errors');
    check(again.action === 'updated', `re-compile updates the strategy (${again.action})`);
    check(again.ownedEntityId === state.owned, 're-compile keeps the same owned legend row');
    const removal = await removeLegendRow(page, state.owned!);
    check(removal.removed, `strategy removed with the tester open (${removal.reason ?? 'ok'})`);
    check(!(await listLegendRows(page)).some((row) => row.entityId === state.owned), 'strategy row is gone');
    state.owned = null;
  },
  logs: async (page) => {
    requireOverwriteFlag();
    const ops = createPageLayoutOps(page);
    await ensureLayout(ops, 'overlay');
    try {
      await writeAndVerify(page, SOURCES.strategy);
      const report = await compileAndCollect(page, {
        previousOwned: state.owned,
        scriptTitles: scriptTitles(SOURCES.strategy),
      });
      check(report.errors.length === 0, 'strategy compiles');
      // An unchanged result means the script is already on the chart; keep the recorded row.
      state.owned = report.ownedEntityId ?? state.owned;
      const result = await readPineLogs(page, ops);
      console.log(JSON.stringify(result.lines.slice(-2)));
      check(
        result.lines.some((line) => line.text.includes('last bar close=')),
        'log.info output of the strategy was read',
      );
      check(result.layoutRestored, 'overlay layout restored after reading logs');
    } finally {
      if (state.owned) {
        await removeLegendRow(page, state.owned);
        state.owned = null;
      }
    }
  },
  chart: async (page) => {
    await ensureLayout(createPageLayoutOps(page), 'overlay');
    const label = await readChartLabel(page);
    check(label !== null, `chart label read (${label?.symbol} ${label?.interval})`);
    check(await isLoggedIn(page), 'logged in to TradingView');
    const png = await takeScreenshot(page);
    check(png.length > 5000, `screenshot captured (${png.length} bytes)`);
  },
  cleanup: async (page) => {
    if (!state.owned) {
      console.log('nothing to clean up');
      return;
    }
    const result = await removeLegendRow(page, state.owned);
    check(result.removed, 'cleanup removed the bridge-owned script');
    state.owned = null;
  },
  driver: async (page) => {
    requireOverwriteFlag();
    const driver = new TvDriver(page);
    try {
      const status = await driver.status();
      check(status.chartOpen && status.loggedIn, `status ok (${status.symbol}, ${status.interval}, ${status.layout})`);
      check(status.sessionDisconnected === false, 'session guard does not fire on the normal chart');

      // A failed first compile makes TradingView add a junk row; that only happens while the script is not on the chart yet.
      // A fresh driver does not know the smoke text left in the editor by earlier runs: override the scratch guard once.
      await driver.setScript(SOURCES.broken, { overwriteExisting: true });
      const broken = await driver.compile();
      check(!broken.compiled && broken.errors.length >= 1, `broken source fails (${broken.errors.length} errors)`);
      check(broken.cleanedErrorRows >= 1, `failed compile junk rows cleaned (${broken.cleanedErrorRows})`);

      await scratchGuardCheck(page, driver);
      check((await driver.getScript()).source.includes('TV Bridge Smoke'), 'set/get script round trip');
      await concurrencyCheck(driver);
      const compiled = await driver.compile();
      check(compiled.compiled && !compiled.runtimeError.present, `compile ok (${compiled.action ?? 'unchanged'})`);
      const again = await driver.compile();
      check(again.unchanged && again.compiled, 'second compile of the same source is unchanged and compiled');

      await driver.setScript(SOURCES.runtimeError);
      const runtime = await driver.compile();
      check(runtime.compiled && runtime.runtimeChecked, 'runtime-error source compiled and status read');
      check(runtime.runtimeError.present, `runtime error surfaced (${runtime.runtimeError.code})`);

      await driver.setScript(SOURCES.strategy);
      check((await driver.compile()).compiled, 'strategy compiled');
      const stats = await driver.readStrategyStats({ includeTrades: true, tradeLimit: 3 });
      check(stats.keyStats.totalPnl !== null && (stats.trades?.length ?? 0) > 0, 'strategy stats and trades read');
      check(
        stats.strategyName === 'TV Bridge Smoke' && stats.matchesOwnedScript === true,
        `driver report identity (${stats.strategyName}, ${stats.matchesOwnedScript})`,
      );
      check(
        typeof stats.tradesTruncated === 'boolean',
        `trade truncation reported (total ${stats.tradesTotal}, truncated ${stats.tradesTruncated})`,
      );
      const logs = await driver.readPineLogs();
      check(logs.lines.some((line) => line.text.includes('last bar close=')) && logs.layoutRestored, 'pine logs read');

      const selftest = await driver.selftest();
      check(selftest.failures.length === 0, `selftest has no required failures (${selftest.failures.join(',') || 'none'})`);
    } finally {
      await driver.removeScript().then(
        (removed) => console.log(`cleanup removeScript removed=${removed.removed}`),
        (error: unknown) => {
          if (!(error instanceof TvError && error.code === 'NOT_OWNED')) throw error;
        },
      );
    }
    check((await driver.status()).layout === 'overlay', 'layout is overlay at the end');
  },
  // SECTIONS-END (add new sections above this line)
};

async function main(): Promise<void> {
  const name = process.argv[2] ?? 'all';
  const { browser, page } = await connect();
  try {
    const names = name === 'all' ? Object.keys(sections) : [name];
    for (const section of names) {
      const run = sections[section];
      if (!run) throw new Error(`Unknown section: ${section}. Known: ${Object.keys(sections).join(', ')}`);
      console.log(`--- ${section}`);
      await run(page);
    }
    console.log('SMOKE PASSED');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
