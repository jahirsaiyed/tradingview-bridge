import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import { runSelftest, selftestAfterLayout, summarizeChecks, type SelectorCheck } from '../../src/driver/selftest.js';
import { TvError } from '../../src/result.js';
import { SEL } from '../../src/selectors.js';

const check = (name: string, found: boolean, required: boolean): SelectorCheck => ({
  name,
  selector: `#${name}`,
  found,
  required,
});

describe('summarizeChecks', () => {
  it('lists only required checks that were not found', () => {
    const failures = summarizeChecks([
      check('overlayRoot', true, true),
      check('editorSurface', false, true),
      check('reportTab', false, false),
    ]);
    expect(failures).toEqual(['editorSurface']);
  });

  it('returns an empty list when everything required is present', () => {
    expect(summarizeChecks([check('a', true, true), check('b', false, false)])).toEqual([]);
  });
});

function fakePage(found: boolean, consoleOpen = true): Page {
  const state = found
    ? { togglePresent: true, toggleActive: consoleOpen, paneHeight: consoleOpen ? 50 : 0 }
    : { togglePresent: false, toggleActive: null, paneHeight: null };
  return {
    locator: () => ({ count: async () => (found ? 1 : 0) }),
    evaluate: async () => state,
  } as unknown as Page;
}

describe('console pane check', () => {
  it('is a required check named consolePane that accepts the pane or its toggle', async () => {
    const checks = await runSelftest(fakePage(true));
    const consoleCheck = checks.find((c) => c.name === 'consolePane');
    expect(consoleCheck?.required).toBe(true);
    expect(consoleCheck?.selector).toContain(SEL.consolePane);
    expect(consoleCheck?.selector).toContain(SEL.consoleToggle);
  });

  it('reports the console state without opening it', async () => {
    const layout = { ensureOverlay: async () => 'overlay' as const, detect: async () => 'overlay' as const };
    expect((await selftestAfterLayout(fakePage(true, true), layout)).console).toBe('open');
    expect((await selftestAfterLayout(fakePage(true, false), layout)).console).toBe('collapsed');
    const missing = await selftestAfterLayout(fakePage(false), layout);
    expect(missing.console).toBe('missing');
    expect(missing.failures).toContain('consolePane');
  });

  it('reports the console state as missing when reading it fails', async () => {
    const page = { locator: () => ({ count: async () => 1 }), evaluate: async () => Promise.reject(new Error('detached')) };
    const payload = await selftestAfterLayout(page as unknown as Page, {
      ensureOverlay: async () => 'overlay',
      detect: async () => 'overlay',
    });
    expect(payload.console).toBe('missing');
  });
});

describe('runSelftest', () => {
  it('reports every selector as found or not', async () => {
    const checks = await runSelftest(fakePage(true));
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every((c) => c.found)).toBe(true);
  });
});

describe('selftestAfterLayout', () => {
  it('keeps the happy path unchanged (no layoutError)', async () => {
    const payload = await selftestAfterLayout(fakePage(true), {
      ensureOverlay: async () => 'overlay',
      detect: async () => 'overlay',
    });
    expect(payload.layout).toBe('overlay');
    expect(payload.failures).toEqual([]);
    expect('layoutError' in payload).toBe(false);
  });

  it('still checks the selectors and reports the layout failure instead of throwing', async () => {
    const payload = await selftestAfterLayout(fakePage(false), {
      ensureOverlay: async () => {
        throw new TvError('LAYOUT_FAILED', 'Could not reach the overlay layout; stuck at closed');
      },
      detect: async () => 'closed',
    });
    expect(payload.layout).toBe('closed');
    expect(payload.layoutError).toMatch(/LAYOUT_FAILED: Could not reach the overlay layout/);
    expect(payload.failures).toContain('overlayRoot');
    expect(payload.failures).toContain('editorSurface');
  });

  it('reports layout "closed" when even detection fails', async () => {
    const payload = await selftestAfterLayout(fakePage(false), {
      ensureOverlay: async () => {
        throw new Error('raw playwright timeout');
      },
      detect: async () => {
        throw new Error('detached');
      },
    });
    expect(payload.layout).toBe('closed');
    expect(payload.layoutError).toBe('raw playwright timeout');
  });
});
