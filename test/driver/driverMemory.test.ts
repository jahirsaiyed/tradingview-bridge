import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright-core';
import type { CompileArgs, CompileReport } from '../../src/driver/compile.js';
import { TvError } from '../../src/result.js';

// The driver's memory rules end to end, with every page-touching module replaced by a fake.
type Step = (args: CompileArgs) => Promise<CompileReport>;
const script: { steps: Step[] } = { steps: [] };

vi.mock('../../src/driver/compile.js', () => ({
  COMPILE_DEADLINE_MS: 45_000,
  compileAndCollect: (_page: unknown, args: CompileArgs) => script.steps.shift()!(args),
}));
vi.mock('../../src/driver/editor.js', () => ({
  copySource: async () => '',
  writeAndReadBack: async (_page: unknown, source: string) => source,
  writeAndVerify: async () => undefined,
  pasteMismatch: () => new TvError('PASTE_MISMATCH', 'x'),
}));
vi.mock('../../src/driver/layout.js', () => ({ ensureLayout: async () => 'overlay' }));
vi.mock('../../src/driver/pageLayoutOps.js', () => ({ createPageLayoutOps: () => ({ detect: async () => 'overlay' }) }));
vi.mock('../../src/driver/sessionGuard.js', () => ({
  ensureSessionConnected: async () => undefined,
  isSessionDisconnected: async () => false,
}));
vi.mock('../../src/driver/chart.js', () => ({
  ensureLoggedIn: async () => undefined,
  isLoggedIn: async () => true,
  navigateToChart: async () => 'https://www.tradingview.com/chart/',
  readChartLabel: async () => null,
  takeScreenshot: async () => Buffer.from(''),
}));
vi.mock('../../src/driver/legend.js', () => ({ removeLegendRow: async () => ({ removed: true }), listLegendRows: async () => [] }));
vi.mock('../../src/driver/connection.js', () => ({ applyPageTimeouts: () => undefined, NAVIGATION_TIMEOUT_MS: 30_000 }));

const { TvDriver } = await import('../../src/driver/driver.js');

const boom = { line: 7, column: 16, message: 'Syntax error' };
const S1 = '//@version=6\nindicator("X")\nplot(close)\n';
const S2 = '//@version=6\nindicator("X")\nplot(close +)\n';
const S3 = '//@version=6\nindicator("X")\nplot(open)\n';

function report(parts: Partial<CompileReport>): CompileReport {
  return {
    action: null,
    errors: [],
    warnings: [],
    runtimeError: { present: false },
    runtimeChecked: false,
    ownedEntityId: 'R',
    ownedStatus: null,
    cleanedErrorRows: 0,
    unchanged: false,
    elapsedMs: 1,
    ...parts,
  };
}

const added: Step = async () => report({ action: 'added', runtimeChecked: true });
const failed: Step = async () => report({ errors: [boom] });
// TradingView: "There is nothing to update."; the row keeps the failed compile's status.
const nothingToUpdate: Step = async () => report({ unchanged: true, ownedStatus: 'Compilation error: CE10156' });
const throwsAfterTrigger: Step = async (args) => {
  args.onTriggered?.();
  throw new TvError('TIMEOUT_COMPILE', 'slow', { phase: 'outcome' });
};
const throwsBeforeTrigger: Step = async () => {
  throw new TvError('SELECTOR_MISSING', 'console');
};

async function runUpToS3(driver: InstanceType<typeof TvDriver>): Promise<void> {
  await driver.setScript(S1, { overwriteExisting: true });
  expect((await driver.compile()).compiled).toBe(true);
  await driver.setScript(S2, { overwriteExisting: true });
  expect((await driver.compile()).compiled).toBe(false);
  await driver.setScript(S3, { overwriteExisting: true });
}

describe('TvDriver compile memory (review sequences)', () => {
  beforeEach(() => {
    script.steps = [];
  });

  it('A: setting another source without compiling keeps the failed outcome of S2', async () => {
    script.steps = [added, failed, nothingToUpdate];
    const driver = new TvDriver({} as Page);
    await runUpToS3(driver);
    await driver.setScript(S2, { overwriteExisting: true });
    const result = await driver.compile();
    expect(result).toMatchObject({ compiled: false, unchanged: true, errors: [boom] });
  });

  it('B: a compile that throws after the trigger never turns a later unchanged S2 into success', async () => {
    script.steps = [added, failed, throwsAfterTrigger, nothingToUpdate];
    const driver = new TvDriver({} as Page);
    await runUpToS3(driver);
    await expect(driver.compile()).rejects.toMatchObject({ code: 'TIMEOUT_COMPILE' });
    await driver.setScript(S2, { overwriteExisting: true });
    const result = await driver.compile();
    expect(result).toMatchObject({ compiled: false, unchanged: true, unknownState: true });
  });

  it('B before the trigger: the S2 failure is still remembered', async () => {
    script.steps = [added, failed, throwsBeforeTrigger, nothingToUpdate];
    const driver = new TvDriver({} as Page);
    await runUpToS3(driver);
    await expect(driver.compile()).rejects.toMatchObject({ code: 'SELECTOR_MISSING' });
    await driver.setScript(S2, { overwriteExisting: true });
    expect(await driver.compile()).toMatchObject({ compiled: false, errors: [boom] });
  });

  it('removeScript and openChart clear the memory', async () => {
    const cleanUnchanged: Step = async () => report({ unchanged: true, ownedEntityId: null });
    script.steps = [failed, cleanUnchanged, failed, cleanUnchanged];
    const driver = new TvDriver({} as Page);
    await driver.setScript(S2, { overwriteExisting: true });
    await driver.compile();
    await driver.removeScript();
    expect(await driver.compile()).toMatchObject({ compiled: false, unknownState: true, errors: [] });
    await driver.compile();
    await driver.openChart({});
    await driver.setScript(S2, { overwriteExisting: true });
    expect(await driver.compile()).toMatchObject({ compiled: false, unknownState: true, errors: [] });
  });
});
