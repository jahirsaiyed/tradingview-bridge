import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { extractScriptTitle } from '../parsers/source.js';
import { compileAndCollect } from './compile.js';
import { withBeforeUnloadAccept } from './dialogs.js';
import { copySource, writeAndVerify } from './editor.js';
import { ensureLayout, type LayoutOps } from './layout.js';
import { removeLegendRow } from './legend.js';
import { createPageLayoutOps } from './pageLayoutOps.js';
import { readPineLogs } from './logsReader.js';
import { readKeyStats, readTrades } from './strategyReader.js';
import { isLoggedIn, navigateToChart, readChartLabel, takeScreenshot } from './chart.js';
import { runSelftest, summarizeChecks } from './selftest.js';
import { cacheForSource, resolveRuntime, type RuntimeCache } from './runtimeCache.js';
import type { CompilePayload, DriverApi, SelftestPayload, StatusInfo, StrategyPayload } from './types.js';

const RELOAD_TIMEOUT_MS = 30_000;

export class TvDriver implements DriverApi {
  private ownedEntityId: string | null = null;
  private lastSource: string | null = null;
  private runtimeCache: RuntimeCache | null = null;
  private readonly layoutOps: LayoutOps;

  constructor(readonly page: Page) {
    this.layoutOps = createPageLayoutOps(page);
  }

  private overlay() {
    return ensureLayout(this.layoutOps, 'overlay');
  }

  async status(): Promise<StatusInfo> {
    const label = await readChartLabel(this.page);
    return {
      loggedIn: await isLoggedIn(this.page),
      chartOpen: label !== null,
      symbol: label?.symbol ?? null,
      interval: label?.interval ?? null,
      layout: await this.layoutOps.detect(),
      url: this.page.url(),
    };
  }

  async openChart(args: { symbol?: string; interval?: string }): Promise<{ url: string }> {
    const url = await navigateToChart(this.page, args);
    this.ownedEntityId = null; // a reload drops unsaved chart contents
    this.runtimeCache = null;
    return { url };
  }

  async setScript(source: string): Promise<{ length: number }> {
    await this.overlay();
    await writeAndVerify(this.page, source);
    this.lastSource = source;
    this.runtimeCache = cacheForSource(this.runtimeCache, source);
    return { length: source.length };
  }

  async getScript(): Promise<{ source: string }> {
    await this.overlay();
    return { source: await copySource(this.page) };
  }

  async compile(): Promise<CompilePayload> {
    await this.overlay();
    const source = this.lastSource ?? (await copySource(this.page));
    const report = await compileAndCollect(this.page, {
      previousOwned: this.ownedEntityId,
      scriptTitle: extractScriptTitle(source),
    });
    this.ownedEntityId = report.ownedEntityId;
    const { view, next } = resolveRuntime(this.runtimeCache, source, {
      unchanged: report.unchanged,
      hasErrors: report.errors.length > 0,
      runtimeError: report.runtimeError,
      runtimeChecked: report.runtimeChecked,
    });
    this.runtimeCache = next;
    return {
      compiled: report.unchanged || (report.errors.length === 0 && report.action !== null),
      action: report.action,
      errors: report.errors,
      warnings: report.warnings,
      runtimeError: view.runtimeError,
      runtimeChecked: view.runtimeChecked,
      cleanedErrorRows: report.cleanedErrorRows,
      unchanged: report.unchanged,
      elapsedMs: report.elapsedMs,
    };
  }

  async screenshot(): Promise<{ png: Buffer }> {
    await this.overlay();
    return { png: await takeScreenshot(this.page) };
  }

  async readPineLogs() {
    return readPineLogs(this.page, this.layoutOps);
  }

  async readStrategyStats(args: { includeTrades: boolean; tradeLimit: number }): Promise<StrategyPayload> {
    await this.overlay();
    try {
      return await this.collectStrategy(args);
    } catch (error) {
      if (!(error instanceof TvError) || error.code !== 'TIMEOUT_REPORT' || !this.lastSource) throw error;
      await this.recoverFromStall(this.lastSource);
      return this.collectStrategy(args);
    }
  }

  private async collectStrategy(args: { includeTrades: boolean; tradeLimit: number }): Promise<StrategyPayload> {
    const keyStats = await readKeyStats(this.page);
    if (!args.includeTrades) return { keyStats };
    const { trades, unparsed } = await readTrades(this.page, args.tradeLimit);
    return { keyStats, trades, unparsedTradeRows: unparsed };
  }

  // Observed once: the Strategy Tester spun forever until the page was reloaded.
  private async recoverFromStall(source: string): Promise<void> {
    await withBeforeUnloadAccept(this.page, async () => {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.locator(SEL.chartCanvas).first().waitFor({ timeout: RELOAD_TIMEOUT_MS });
    });
    // The owned id is kept through the reload: compile() keeps it only if that row is still on the
    // chart under the script title, otherwise it claims only a fresh row or nothing (fail safe).
    this.runtimeCache = null;
    try {
      await this.overlay();
      await writeAndVerify(this.page, source);
      const result = await this.compile();
      if (!result.compiled) {
        throw new TvError('INTERNAL', 'Re-compile after the report stall failed', { errors: result.errors });
      }
    } catch (error) {
      // Ownership could not be re-established after the reload: never keep a possibly stale id.
      this.ownedEntityId = null;
      throw error;
    }
  }

  async removeScript(): Promise<{ removed: boolean; reason?: string }> {
    if (!this.ownedEntityId) {
      throw new TvError('NOT_OWNED', 'No script has been added by this bridge in this session');
    }
    await this.overlay();
    const result = await removeLegendRow(this.page, this.ownedEntityId);
    this.ownedEntityId = null;
    this.runtimeCache = null;
    return result;
  }

  async selftest(): Promise<SelftestPayload> {
    const layout = await this.overlay();
    const checks = await runSelftest(this.page);
    return { layout, checks, failures: summarizeChecks(checks) };
  }
}
