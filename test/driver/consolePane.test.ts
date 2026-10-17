import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import {
  decideConsole,
  ensureConsoleOpen,
  readConsole,
  type ConsolePaneState,
} from '../../src/driver/consolePane.js';
import { SEL } from '../../src/selectors.js';
import { TvError } from '../../src/result.js';

const OPEN: ConsolePaneState = { togglePresent: true, toggleActive: true, paneHeight: 50 };
const COLLAPSED: ConsolePaneState = { togglePresent: true, toggleActive: false, paneHeight: 0 };
const NO_TOGGLE: ConsolePaneState = { togglePresent: false, toggleActive: null, paneHeight: 0 };

const CONSOLE_TEXT = 'Pine Editor\n7:16:01 PM\tCompiling...\n7:16:03 PM\tCompiled.\n7:16:03 PM\tAdded to chart.';

interface Fake {
  readonly page: Page;
  readonly log: string[];
}

/** Console states are served in order (the last one repeats); a click opens the pane when `opensOnClick`. */
function fakePage(states: readonly ConsolePaneState[], opensOnClick = true): Fake {
  const log: string[] = [];
  let index = 0;
  let clicked = false;
  const current = (): ConsolePaneState => (clicked && opensOnClick ? OPEN : states[Math.min(index, states.length - 1)]!);
  const page = {
    evaluate: async () => {
      const state = current();
      index += 1;
      log.push(decideConsole(state) === 'ready' ? 'state:open' : 'state:closed');
      return state;
    },
    locator: (selector: string) => {
      const handle = {
        first: () => handle,
        click: async () => {
          log.push(`click:${selector === SEL.consoleToggle ? 'toggle' : selector}`);
          clicked = true;
        },
        innerText: async () => {
          log.push(`innerText:${selector === SEL.overlayRoot ? 'overlay' : selector}`);
          return CONSOLE_TEXT;
        },
      };
      return handle;
    },
  } as unknown as Page;
  return { page, log };
}

const fast = { timeoutMs: 1000, sleep: async () => undefined };

describe('decideConsole', () => {
  it('is ready when the pane has a height', () => {
    expect(decideConsole(OPEN)).toBe('ready');
  });

  it('expands a collapsed pane that has its toggle', () => {
    expect(decideConsole(COLLAPSED)).toBe('expand');
  });

  it('is missing when the pane is collapsed and no toggle exists', () => {
    expect(decideConsole(NO_TOGGLE)).toBe('missing');
    expect(decideConsole({ togglePresent: false, toggleActive: null, paneHeight: null })).toBe('missing');
  });

  it('trusts an active toggle when the pane element itself is not found', () => {
    expect(decideConsole({ togglePresent: true, toggleActive: true, paneHeight: null })).toBe('ready');
  });

  it('waits, never clicks, when the toggle is already active but the pane has no height yet', () => {
    expect(decideConsole({ togglePresent: true, toggleActive: true, paneHeight: 0 })).toBe('wait');
  });
});

describe('ensureConsoleOpen', () => {
  it('does nothing when the console is already open', async () => {
    const fake = fakePage([OPEN]);
    expect(await ensureConsoleOpen(fake.page, fast)).toEqual({ opened: false });
    expect(fake.log).toEqual(['state:open']);
  });

  it('clicks the toggle once and waits until the pane is open', async () => {
    const fake = fakePage([COLLAPSED]);
    expect(await ensureConsoleOpen(fake.page, fast)).toEqual({ opened: true });
    expect(fake.log).toEqual(['state:closed', 'click:toggle', 'state:open']);
  });

  it('fails with SELECTOR_MISSING, not a timeout, when there is no toggle', async () => {
    const fake = fakePage([NO_TOGGLE]);
    const error = await ensureConsoleOpen(fake.page, fast).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TvError);
    expect((error as TvError).code).toBe('SELECTOR_MISSING');
    expect((error as TvError).message).toMatch(/open the Pine Editor's console pane/i);
    expect((error as TvError).details?.selector).toBe(SEL.consoleToggle);
    expect(fake.log).not.toContain('click:toggle');
  });

  it('clicks only once and fails with SELECTOR_MISSING when the pane never opens', async () => {
    let now = 0;
    const fake = fakePage([COLLAPSED], false);
    const options = { timeoutMs: 1000, now: () => now, sleep: async (ms: number) => void (now += ms) };
    const error = await ensureConsoleOpen(fake.page, options).catch((caught: unknown) => caught);
    expect((error as TvError).code).toBe('SELECTOR_MISSING');
    expect((error as TvError).details).toMatchObject({ selector: SEL.consoleToggle, reason: 'not-opened' });
    expect(fake.log.filter((entry) => entry === 'click:toggle')).toHaveLength(1);
  });

  it('turns a toggle that cannot be clicked (present but hidden) into SELECTOR_MISSING with the hint', async () => {
    const fake = fakePage([COLLAPSED]);
    const page = {
      ...fake.page,
      evaluate: fake.page.evaluate,
      locator: () => ({
        first: () => ({
          click: async (options: { timeout: number }) => {
            fake.log.push(`click-timeout:${options.timeout}`);
            throw new Error('locator.click: Timeout 5000ms exceeded (element is not visible)');
          },
        }),
      }),
    } as unknown as Page;
    const error = await ensureConsoleOpen(page, { ...fast, clickTimeoutMs: 1234 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TvError);
    expect((error as TvError).code).toBe('SELECTOR_MISSING');
    expect((error as TvError).message).toMatch(/open the Pine Editor's console pane/i);
    expect((error as TvError).details).toMatchObject({ selector: SEL.consoleToggle, reason: 'not-clickable' });
    expect(fake.log).toContain('click-timeout:1234');
  });

  it('waits for a pane that is already opening without clicking it closed', async () => {
    const opening: ConsolePaneState = { togglePresent: true, toggleActive: true, paneHeight: 0 };
    const fake = fakePage([opening, opening, OPEN]);
    expect(await ensureConsoleOpen(fake.page, fast)).toEqual({ opened: false });
    expect(fake.log).not.toContain('click:toggle');
  });
});

describe('readConsole', () => {
  it('reads the console text only after the pane is open', async () => {
    const fake = fakePage([COLLAPSED]);
    const { entries } = await readConsole(fake.page);
    expect(fake.log).toEqual(['state:closed', 'click:toggle', 'state:open', 'innerText:overlay']);
    expect(entries.map((entry) => entry.message)).toEqual(['Compiling...', 'Compiled.', 'Added to chart.']);
  });

  it('never reads a hidden console: the missing-toggle error comes first', async () => {
    const fake = fakePage([NO_TOGGLE]);
    await expect(readConsole(fake.page)).rejects.toMatchObject({ code: 'SELECTOR_MISSING' });
    expect(fake.log).not.toContain('innerText:overlay');
  });
});
