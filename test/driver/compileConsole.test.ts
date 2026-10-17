import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import { compileAndCollect } from '../../src/driver/compile.js';
import type { ConsolePaneState } from '../../src/driver/consolePane.js';
import { SEL } from '../../src/selectors.js';

const COLLAPSED: ConsolePaneState = { togglePresent: true, toggleActive: false, paneHeight: 0 };
const OPEN: ConsolePaneState = { togglePresent: true, toggleActive: true, paneHeight: 50 };

// Enough of a page for compileAndCollect: console, legend and the apply button (disabled unless consoleAfter is set).
function fakePage(initial: ConsolePaneState, consoleAfter: string | null = null) {
  const log: string[] = [];
  let state = initial;
  let triggered = false;
  const page = {
    keyboard: {
      press: async (key: string) => {
        log.push(`key:${key}`);
        triggered = true;
      },
    },
    evaluate: async (_fn: unknown, arg: unknown) => {
      if (arg !== null && typeof arg === 'object' && 'toggleSelector' in arg) {
        log.push(state === OPEN ? 'state:open' : 'state:closed');
        return state;
      }
      log.push('legend');
      return [];
    },
    locator: (selector: string) => {
      const handle = {
        first: () => handle,
        click: async () => {
          log.push(selector === SEL.consoleToggle ? 'click:toggle' : `click:${selector}`);
          if (selector === SEL.consoleToggle) state = OPEN;
        },
        innerText: async () => {
          log.push(state === OPEN ? 'console-read:open' : 'console-read:hidden');
          return triggered && consoleAfter !== null ? consoleAfter : '';
        },
        count: async () => 1,
        isDisabled: async () => consoleAfter === null,
      };
      return handle;
    },
  } as unknown as Page;
  return { page, log };
}

describe('compileAndCollect console pane', () => {
  it('opens a collapsed console before the baseline console read', async () => {
    const fake = fakePage(COLLAPSED);
    const report = await compileAndCollect(fake.page, { previousOwned: null, scriptTitles: [] });
    expect(report.unchanged).toBe(true);
    const firstRead = fake.log.findIndex((entry) => entry.startsWith('console-read'));
    expect(fake.log[firstRead]).toBe('console-read:open');
    expect(fake.log.indexOf('click:toggle')).toBeGreaterThanOrEqual(0);
    expect(fake.log.indexOf('click:toggle')).toBeLessThan(firstRead);
    expect(fake.log).not.toContain('console-read:hidden');
  });

  it('reports "There is nothing to update." as unchanged instead of timing out', async () => {
    const fake = fakePage(OPEN, '7:30:00 PM\tThere is nothing to update.');
    const report = await compileAndCollect(fake.page, { previousOwned: null, scriptTitles: [], timeoutMs: 1000 });
    expect(fake.log).toContain('key:Control+Enter');
    expect(report).toMatchObject({ unchanged: true, action: null, errors: [], ownedEntityId: null });
  });

  it('does not touch an already open console', async () => {
    const fake = fakePage(OPEN);
    await compileAndCollect(fake.page, { previousOwned: null, scriptTitles: [] });
    expect(fake.log).not.toContain('click:toggle');
  });
});
