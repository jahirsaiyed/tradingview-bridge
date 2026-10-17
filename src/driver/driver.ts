import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { scriptTitles } from '../parsers/source.js';
import { COMPILE_DEADLINE_MS, compileAndCollect } from './compile.js';
import {
  nextMemory,
  ownedAfterCompileError,
  recoveryCompileAccepted,
  resolveCompiled,
  type CompileMemory,
} from './compileMemory.js';
import { withBeforeUnloadAccept } from './dialogs.js';
import { copySource, pasteMismatch, writeAndReadBack, writeAndVerify } from './editor.js';
import { ensureLayout, type LayoutOps } from './layout.js';
import { listLegendRows, removeLegendRow } from './legend.js';
import { createMutex } from './mutex.js';
import { createPageLayoutOps } from './pageLayoutOps.js';
import { readPineLogs } from './logsReader.js';
import { readKeyStats, readReportStrategyName, readTrades } from './strategyReader.js';
import { collectReport, readStatsWithRecovery, type ReportSteps } from './reportFlow.js';
import { createDeadline, type Deadline } from './deadline.js';
import { waitForRowSettled } from './rowSettle.js';
import { ensureSessionConnected, isSessionDisconnected } from './sessionGuard.js';
import { ensureLoggedIn, isLoggedIn, navigateToChart, readChartLabel, takeScreenshot } from './chart.js';
import { applyPageTimeouts, NAVIGATION_TIMEOUT_MS } from './connection.js';
import { selftestAfterLayout } from './selftest.js';
import { cacheForSource, resolveRuntime, type RuntimeCache } from './runtimeCache.js';
import { isSafeToOverwrite, recordPaste } from './scratch.js';
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
/**
 * Shared budget of one tv_read_strategy_stats call without reload (row settle 15 s + render 30 s + stable 15 s
 * + name 2 s + trades 5 s would be 67 s); a reload recovery gets a fresh one for its second read.
 */
const STATS_DEADLINE_MS = 50_000;

const NOT_SCRATCH_MESSAGE =
  'The Pine Editor holds a script this bridge did not write in this session (it may be one of the ' +
  "owner's scripts), so it was not replaced. Ask the owner first: open a new scratch script in the " +
  'Pine Editor, or retry with overwriteExisting: true only after the owner confirms it may be replaced.';

// tv_read_strategy_stats has no overwriteExisting argument, so the recovery path has its own message.
const RECOVERY_NOT_SCRATCH_MESSAGE =
  'The Pine Editor content changed during the reload recovery: it now holds a script this bridge did not ' +
  'write, so the bridge refused to re-paste over it. Ask the owner, or open a new scratch script, set the ' +
  'script again with tv_set_script and compile, then retry tv_read_strategy_stats.';

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
  /** Last real compile outcome for a source; cleared with the same rules as runtimeCache. */
  private compileMemory: CompileMemory | null = null;
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
    await ensureSessionConnected(this.page);
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
      sessionDisconnected: await isSessionDisconnected(this.page),
    };
  }

  private async openChartImpl(args: { symbol?: string; interval?: string }): Promise<{ url: string }> {
    await this.ready();
    const url = await navigateToChart(this.page, args);
    this.ownedEntityId = null; // a reload drops unsaved chart contents
    this.runtimeCache = null;
    this.compileMemory = nextMemory(this.compileMemory, { kind: 'openChart' });
    this.lastSource = null; // the reloaded editor may hold a different script
    return { url };
  }

  private async assertScratch(message: string = NOT_SCRATCH_MESSAGE): Promise<void> {
    const current = await copySource(this.page).catch((error: unknown) => {
      if (error instanceof TvError && error.code === 'PASTE_MISMATCH') return null; // unreadable
      throw error;
    });
    if (current !== null && isSafeToOverwrite(current, new Set(this.knownTexts))) return;
    const prefix = current === null ? 'The Pine Editor contents could not be read. ' : '';
    throw new TvError('EDITOR_NOT_SCRATCH', prefix + message, { editorReadable: current !== null });
  }

  private async setScriptImpl(source: string, options?: SetScriptOptions): Promise<{ length: number }> {
    await this.overlay();
    if (options?.overwriteExisting !== true) await this.assertScratch();
    let readBack: string;
    try {
      readBack = await writeAndReadBack(this.page, source);
    } catch (error) {
      this.lastSource = null; // the editor may now hold anything: no stale title or cache key
      throw error;
    }
    // On a mismatch the read-back text is what the bridge itself left in the editor: remember it too.
    const { matched, known } = recordPaste(this.knownTexts, source, readBack);
    this.knownTexts = known;
    if (!matched) {
      this.lastSource = null;
      throw pasteMismatch(source, readBack);
    }
    this.lastSource = source;
    this.runtimeCache = cacheForSource(this.runtimeCache, source);
    this.compileMemory = nextMemory(this.compileMemory, { kind: 'setScript' }); // keyed by source, so kept
    return { length: source.length };
  }

  private async getScriptImpl(): Promise<{ source: string }> {
    await this.overlay();
    const source = await copySource(this.page);
    this.lastSource = source; // title and runtime cache follow the real editor text
    return { source };
  }

  private async compileImpl(): Promise<CompilePayload> {
    const deadline = createDeadline(COMPILE_DEADLINE_MS); // one budget for the whole call, overlay included
    await this.overlay();
    const source = this.lastSource ?? (await copySource(this.page));
    let triggered = false;
    const report = await compileAndCollect(this.page, {
      previousOwned: this.ownedEntityId,
      scriptTitles: scriptTitles(source),
      deadline,
      onTriggered: () => {
        triggered = true;
      },
    }).catch((error: unknown) => {
      // Out of budget after the compile ran: keep owning the row it applied; its outcome is unknown.
      this.ownedEntityId = ownedAfterCompileError(error, this.ownedEntityId);
      this.compileMemory = nextMemory(this.compileMemory, { kind: 'compileError', source, triggered });
      throw error;
    });
    this.ownedEntityId = report.ownedEntityId;
    const { view, next } = resolveRuntime(this.runtimeCache, source, {
      unchanged: report.unchanged,
      hasErrors: report.errors.length > 0,
      runtimeError: report.runtimeError,
      runtimeChecked: report.runtimeChecked,
    });
    this.runtimeCache = next;
    const outcome = resolveCompiled(this.compileMemory, source, report);
    this.compileMemory = outcome.next;
    return {
      compiled: outcome.result.compiled,
      action: report.action,
      errors: outcome.result.errors,
      warnings: report.warnings,
      runtimeError: view.runtimeError,
      runtimeChecked: view.runtimeChecked,
      cleanedErrorRows: report.cleanedErrorRows,
      unchanged: report.unchanged,
      ...(outcome.result.unknownState ? { unknownState: true as const } : {}),
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
    const deadline = createDeadline(STATS_DEADLINE_MS); // one budget for the whole call, overlay included
    await this.overlay();
    const source = this.lastSource;
    return readStatsWithRecovery(
      {
        collect: (budget) => this.collectStrategy(args, budget),
        recover: source ? () => this.recoverFromStall(source) : null,
        newDeadline: () => createDeadline(STATS_DEADLINE_MS),
      },
      deadline,
      args.allowReload === true,
    );
  }

  private collectStrategy(args: StrategyArgs, deadline: Deadline): Promise<StrategyPayload> {
    const page = this.page;
    const owned = this.ownedEntityId;
    // A recompile recalculates the report: wait (bounded) until the owned row stops loading first.
    const steps: ReportSteps = {
      settleRow: owned ? async (ms) => void (await waitForRowSettled(page, owned, ms)) : null,
      readKeyStats: (budget) => readKeyStats(page, undefined, budget),
      readStrategyName: (ms) => readReportStrategyName(page, ms),
      readTrades: (limit, ms) => readTrades(page, limit, ms),
    };
    const names = this.lastSource ? scriptTitles(this.lastSource) : [];
    return collectReport(steps, { names, includeTrades: args.includeTrades, tradeLimit: args.tradeLimit }, deadline);
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
    this.compileMemory = nextMemory(this.compileMemory, { kind: 'recovery' });
    try {
      await this.overlay();
      await this.assertScratch(RECOVERY_NOT_SCRATCH_MESSAGE); // the reloaded editor may hold a different script
      await writeAndVerify(this.page, source);
      const result = await this.compileImpl(); // never the public compile(): the mutex is held
      // An unknown state (unchanged source, row re-created by the reload) passes only with a matching row.
      if (!recoveryCompileAccepted(result, await listLegendRows(this.page), scriptTitles(source))) {
        throw new TvError('INTERNAL', 'Re-compile after the report stall failed', { errors: result.errors });
      }
    } catch (error) {
      // Ownership could not be re-established after the reload: never keep a possibly stale id, except the
      // row a re-compile that ran out of budget just applied (named by its deadline error).
      this.ownedEntityId = ownedAfterCompileError(error, null);
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
    this.compileMemory = nextMemory(this.compileMemory, { kind: 'removeScript' });
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
