import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import { runSelftest, selftestAfterLayout, summarizeChecks, type SelectorCheck } from '../../src/driver/selftest.js';
import { TvError } from '../../src/result.js';

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

function fakePage(found: boolean): Page {
  return { locator: () => ({ count: async () => (found ? 1 : 0) }) } as unknown as Page;
}

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
