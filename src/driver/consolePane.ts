import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { parseConsoleEntries, parseProblemCodes, type ConsoleEntry, type ProblemCode } from '../parsers/console.js';
import { pollUntil, type PollOptions } from './waits.js';

/**
 * The overlay editor's console pane. On a fresh TradingView layout it is collapsed (height 0), and a
 * collapsed pane's lines are not part of the rendered text, so every compile would time out unread.
 * The bridge opens it with one click on its toggle and leaves it open: every compile reads it.
 */
export interface ConsolePaneState {
  readonly togglePresent: boolean;
  /** The toggle's data-active attribute; null when there is no toggle or no such attribute. */
  readonly toggleActive: boolean | null;
  /** Rendered height of the pane; null when the pane element is not found. */
  readonly paneHeight: number | null;
}

/** ready: readable now. expand: click the toggle. wait: already opening, never click. missing: cannot open. */
export type ConsoleDecision = 'ready' | 'expand' | 'wait' | 'missing';

export function decideConsole(state: ConsolePaneState): ConsoleDecision {
  if (state.paneHeight !== null && state.paneHeight > 0) return 'ready';
  if (state.toggleActive === true) return state.paneHeight === null ? 'ready' : 'wait';
  return state.togglePresent ? 'expand' : 'missing';
}

const OPEN_TIMEOUT_MS = 3000;
const OPEN_INTERVAL_MS = 150;
const CLICK_TIMEOUT_MS = 5000;

const HINT =
  "Open the Pine Editor's console pane (the >_ button at the bottom-left of the editor, or Ctrl+`) and retry.";

const REASON_TEXT = {
  missing: 'The Pine Editor console pane is hidden and its toggle was not found',
  'not-clickable': 'The Pine Editor console pane is hidden and its toggle could not be clicked',
  'not-opened': 'The Pine Editor console pane did not open after clicking its toggle',
} as const;

export type ConsoleUnreadableReason = keyof typeof REASON_TEXT;

export function consoleUnreadableError(reason: ConsoleUnreadableReason, state: ConsolePaneState): TvError {
  const what = REASON_TEXT[reason];
  return new TvError('SELECTOR_MISSING', `${what}, so compile results cannot be read. ${HINT}`, {
    selector: SEL.consoleToggle,
    reason,
    state,
  });
}

export async function readConsolePaneState(page: Page): Promise<ConsolePaneState> {
  return page.evaluate(
    ({ toggleSelector, paneSelector }) => {
      const toggle = document.querySelector(toggleSelector);
      const pane = document.querySelector(paneSelector);
      const active = toggle?.getAttribute('data-active');
      return {
        togglePresent: toggle !== null,
        toggleActive: active === 'true' ? true : active === 'false' ? false : null,
        paneHeight: pane ? pane.getBoundingClientRect().height : null,
      };
    },
    { toggleSelector: SEL.consoleToggle, paneSelector: SEL.consolePane },
  );
}

export type OpenOptions = Pick<PollOptions, 'now' | 'sleep'> & {
  readonly timeoutMs?: number;
  /** Bound of the click on the toggle (default 5 s). */
  readonly clickTimeoutMs?: number;
};

// A toggle that exists but cannot be clicked (hidden, covered) is the same owner action as a missing one.
async function clickToggle(page: Page, state: ConsolePaneState, timeoutMs: number): Promise<void> {
  try {
    await page.locator(SEL.consoleToggle).first().click({ timeout: timeoutMs });
  } catch {
    throw consoleUnreadableError('not-clickable', state);
  }
}

/**
 * Makes the console readable: clicks a collapsed pane's toggle at most once, then waits (bounded) until
 * it is open. Never clicks a toggle that is already active (that would close it again). Fails with
 * SELECTOR_MISSING instead of letting a compile time out on a hidden console.
 */
export async function ensureConsoleOpen(page: Page, options: OpenOptions = {}): Promise<{ opened: boolean }> {
  const initial = await readConsolePaneState(page);
  const decision = decideConsole(initial);
  if (decision === 'ready') return { opened: false };
  if (decision === 'missing') throw consoleUnreadableError('missing', initial);
  if (decision === 'expand') await clickToggle(page, initial, options.clickTimeoutMs ?? CLICK_TIMEOUT_MS);
  let last = initial;
  const open = await pollUntil(
    async () => {
      last = await readConsolePaneState(page);
      return decideConsole(last) === 'ready';
    },
    { timeoutMs: options.timeoutMs ?? OPEN_TIMEOUT_MS, intervalMs: OPEN_INTERVAL_MS, now: options.now, sleep: options.sleep },
  );
  if (!open) throw consoleUnreadableError('not-opened', last);
  return { opened: decision === 'expand' };
}

/**
 * Reads the console lines and problem codes from the overlay editor, after making sure the pane is open.
 * The whole overlay text is read on purpose: problem codes come from the editor's marker widget too.
 */
export async function readConsole(
  page: Page,
  options: OpenOptions = {},
): Promise<{ entries: ConsoleEntry[]; problems: ProblemCode[] }> {
  await ensureConsoleOpen(page, options);
  const text = await page.locator(SEL.overlayRoot).first().innerText();
  return { entries: parseConsoleEntries(text), problems: parseProblemCodes(text) };
}
