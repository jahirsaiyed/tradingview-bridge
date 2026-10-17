import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { scriptTitles } from '../parsers/source.js';
import { compileAndCollect } from './compile.js';
import { deriveCompiled } from './compileState.js';
import { withBeforeUnloadAccept } from './dialogs.js';
import { copySource, writeAndVerify } from './editor.js';
import { ensureLayout, type LayoutOps } from './layout.js';
import { removeLegendRow } from './legend.js';
import { createMutex } from './mutex.js';
import { createPageLayoutOps } from './pageLayoutOps.js';
import { readPineLogs } from './logsReader.js';
import { readKeyStats, readTrades } from './strategyReader.js';
import { ensureLoggedIn, isLoggedIn, navigateToChart, readChartLabel, takeScreenshot } from './chart.js';
import { applyPageTimeouts, NAVIGATION_TIMEOUT_MS } from './connection.js';
import { selftestAfterLayout } from './selftest.js';
import { cacheForSource, resolveRuntime, type RuntimeCache } from './runtimeCache.js';
import { isSafeToOverwrite, rememberText } from './scratch.js';
import { reportTimeoutError, strategyPayload } from './strategyPayload.js';
import type {
  CompilePayload,
  DriverApi,
  SelftestPayload,
  SetScriptOptions,
  StatusInfo,
  StrategyArgs,
  StrategyPayload,
} from './types.js';

const RELOAD_TIMEOUT_MS = 30_000;

const NOT_SCRATCH_MESSAGE =
  'The Pine Editor holds a script this bridge did not write in this session (it may be one of the ' +
  "owner's scripts), so it was not replaced. Ask the owner first: open a new scratch script in the " +
  'Pine Editor, or retry with overwriteExisting: true only after the owner confirms it may be replaced.';

export class TvDriver implements DriverApi {
  /**
   * Serializes every public DriverApi call: parallel tool calls would otherwise interleave
   * Ctrl+A/Ctrl+V and the clipboard sentinel/restore. RULE: each public method is only a wrapper
   * `this.mutex.run(() => this.<name>Impl(...))`; internal code calls the *Impl methods and private
   * helpers, NEVER a public wrapper. The mutex is not re-entrant, so e.g. recoverFromStall calling
   * compile() instead of compileImpl() would wait on itself forever (deadlock).
   */
  private readonly mutex = createMutex();
  private ownedEntityId: string | null = null;
  private lastSource: string | null = null;
  private runtimeCache: RuntimeCache | null = null;
  /** Normalized texts this bridge pasted (bounded); kept across openChart on purpose. */
  private knownTexts: readonly string[] = [];
  private readonly layoutOps: LayoutOps;

  constructor(readonly page: Page) {
    // 10 s for every Playwright action without an explicit timeout; navigation explicitly stays at 30 s.
    applyPageTimeouts(page);
    this.layoutOps = createPageLayoutOps(page);
  }

  status(): Promise<StatusInfo> {
    return this.mutex.run(() => this.statusImpl());
  }

  openChart(args: { symbol?: string; interval?: string }): Promise<{ url: string }> {
    return this.mutex.run(() => this.openChartImpl(args));
  }

  setScript(source: string, options?: SetScriptOptions): Promise<{ length: number }> {
    return this.mutex.run(() => this.setScriptImpl(source, options));
  }

  getScript(): Promise<{ source: string }> {
    return this.mutex.run(() => this.getScriptImpl());
  }

  compile(): Promise<CompilePayload> {
    return this.mutex.run(() => this.compileImpl());
  }

  screenshot(): Promise<{ png: Buffer }> {
    return this.mutex.run(() => this.screenshotImpl());
  }

  readPineLogs(): ReturnType<DriverApi['readPineLogs']> {
    return this.mutex.run(() => this.readPineLogsImpl());
  }

  readStrategyStats(args: StrategyArgs): Promise<StrategyPayload> {
    return this.mutex.run(() => this.readStrategyStatsImpl(args));
  }

  removeScript(): Promise<{ removed: boolean; reason?: string }> {
    return this.mutex.run(() => this.removeScriptImpl());
  }

  selftest(): Promise<SelftestPayload> {
    return this.mutex.run(() => this.selftestImpl());
  }

  // ---- implementations: call only each other and private helpers, never the public wrappers ----

  // Every tool except status passes through here (directly or via overlay()).
  private async ready(): Promise<void> {
    await ensureLoggedIn(this.page);
  }

  private async overlay() {
    await this.ready();
    return ensureLayout(this.layoutOps, 'overlay');
  }

  private async statusImpl(): Promise<StatusInfo> {
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

  private async openChartImpl(args: { symbol?: string; interval?: string }): Promise<{ url: string }> {
    await this.ready();
    const url = await navigateToChart(this.page, args);
    this.ownedEntityId = null; // a reload drops unsaved chart contents
    this.runtimeCache = null;
    this.lastSource = null; // the reloaded editor may hold a different script
    return { url };
  }

  private async assertScratch(): Promise<void> {
    const current = await copySource(this.page).catch((error: unknown) => {
      if (error instanceof TvError && error.code === 'PASTE_MISMATCH') return null; // unreadable
      throw error;
    });
    if (current !== null && isSafeToOverwrite(current, new Set(this.knownTexts))) return;
    const prefix = current === null ? 'The Pine Editor contents could not be read. ' : '';
    throw new TvError('EDITOR_NOT_SCRATCH', prefix + NOT_SCRATCH_MESSAGE, { editorReadable: current !== null });
  }

  private async setScriptImpl(source: string, options?: SetScriptOptions): Promise<{ length: number }> {
    await this.overlay();
    if (options?.overwriteExisting !== true) await this.assertScratch();
    try {
      await writeAndVerify(this.page, source);
    } catch (error) {
      this.lastSource = null; // the editor may now hold anything: no stale title or cache key
      throw error;
    }
    this.knownTexts = rememberText(this.knownTexts, source);
    this.lastSource = source;
    this.runtimeCache = cacheForSource(this.runtimeCache, source);
    return { length: source.length };
  }

  private async getScriptImpl(): Promise<{ source: string }> {
    await this.overlay();
    const source = await copySource(this.page);
    this.lastSource = source; // title and runtime cache follow the real editor text
    return { source };
  }

  private async compileImpl(): Promise<CompilePayload> {
    await this.overlay();
    const source = this.lastSource ?? (await copySource(this.page));
    const report = await compileAndCollect(this.page, {
      previousOwned: this.ownedEntityId,
      scriptTitles: scriptTitles(source),
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
      compiled: deriveCompiled(report),
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

  private async screenshotImpl(): Promise<{ png: Buffer }> {
    await this.overlay();
    return { png: await takeScreenshot(this.page) };
  }

  private async readPineLogsImpl(): ReturnType<DriverApi['readPineLogs']> {
    await this.ready();
    return readPineLogs(this.page, this.layoutOps);
  }

  private async readStrategyStatsImpl(args: StrategyArgs): Promise<StrategyPayload> {
    await this.overlay();
    try {
      return await this.collectStrategy(args);
    } catch (error) {
      if (!(error instanceof TvError) || error.code !== 'TIMEOUT_REPORT') throw error;
      if (args.allowReload !== true) throw reportTimeoutError(error, 'reload-not-allowed');
      if (!this.lastSource) throw reportTimeoutError(error, 'no-script');
      await this.recoverFromStall(this.lastSource);
      return this.collectStrategy(args);
    }
  }

  private async collectStrategy(args: StrategyArgs): Promise<StrategyPayload> {
    const keyStats = await readKeyStats(this.page);
    if (!args.includeTrades) return strategyPayload(keyStats);
    const { trades, unparsed } = await readTrades(this.page, args.tradeLimit);
    return strategyPayload(keyStats, { trades, unparsed, limit: args.tradeLimit });
  }

  // Observed once: the Strategy Tester spun forever until the page was reloaded.
  private async recoverFromStall(source: string): Promise<void> {
    await withBeforeUnloadAccept(this.page, async () => {
      await this.page.reload({ waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
      await this.page.locator(SEL.chartCanvas).first().waitFor({ timeout: RELOAD_TIMEOUT_MS });
    });
    // The owned id is kept through the reload: compileImpl() keeps it only if that row is still on the
    // chart under a script name, otherwise it claims only a fresh row or nothing (fail safe).
    this.runtimeCache = null;
    try {
      await this.overlay();
      await this.assertScratch(); // the reloaded editor may hold a different script
      await writeAndVerify(this.page, source);
      const result = await this.compileImpl(); // never the public compile(): the mutex is held
      if (!result.compiled) {
        throw new TvError('INTERNAL', 'Re-compile after the report stall failed', { errors: result.errors });
      }
    } catch (error) {
      // Ownership could not be re-established after the reload: never keep a possibly stale id.
      this.ownedEntityId = null;
      throw error;
    }
  }

  private async removeScriptImpl(): Promise<{ removed: boolean; reason?: string }> {
    if (!this.ownedEntityId) {
      throw new TvError('NOT_OWNED', 'No script has been added by this bridge in this session');
    }
    await this.overlay();
    const result = await removeLegendRow(this.page, this.ownedEntityId);
    this.ownedEntityId = null;
    this.runtimeCache = null;
    return result;
  }

  private async selftestImpl(): Promise<SelftestPayload> {
    await this.ready();
    return selftestAfterLayout(this.page, {
      ensureOverlay: () => ensureLayout(this.layoutOps, 'overlay'),
      detect: () => this.layoutOps.detect(),
    });
  }
}
