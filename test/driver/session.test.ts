import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright-core';
import { isSessionDisconnectedText } from '../../src/driver/session.js';
import {
  collectPageText,
  ensureSessionConnected,
  isSessionDisconnected,
  SESSION_TEXT_EXCLUDED,
} from '../../src/driver/sessionGuard.js';
import { TvError } from '../../src/result.js';

const REAL_TEXT =
  'Session disconnected Your session ended because your account was accessed from another browser or device. ' +
  'To comply with market data regulations, only one active session is allowed per user.';

describe('isSessionDisconnectedText', () => {
  it('detects the real modal text', () => {
    expect(isSessionDisconnectedText(REAL_TEXT)).toBe(true);
  });

  it('is case-insensitive and tolerant of whitespace and line breaks', () => {
    const messy = 'chart stuff\nSESSION   DISCONNECTED\n\nYour session ended because your account was accessed from\nanother  browser or\tdevice.';
    expect(isSessionDisconnectedText(messy)).toBe(true);
  });

  it('needs both the title and the other-device phrase', () => {
    expect(isSessionDisconnectedText('Session disconnected')).toBe(false);
    expect(isSessionDisconnectedText('accessed from another browser or device')).toBe(false);
  });

  it('does not fire on normal chart text', () => {
    expect(isSessionDisconnectedText('EURUSD 1h Pine Editor Strategy Tester Total PnL')).toBe(false);
    expect(isSessionDisconnectedText('')).toBe(false);
  });
});

function fakePage(evaluate: () => Promise<unknown>): Page {
  return { evaluate } as unknown as Page;
}

describe('session guard on a fake page', () => {
  it('passes on a normal chart page', async () => {
    const page = fakePage(async () => 'EURUSD Pine Editor Session History');
    await expect(ensureSessionConnected(page)).resolves.toBeUndefined();
    expect(await isSessionDisconnected(page)).toBe(false);
  });

  it('throws SESSION_DISCONNECTED with an actionable message when the modal is shown', async () => {
    const page = fakePage(async () => REAL_TEXT);
    expect(await isSessionDisconnected(page)).toBe(true);
    const error = await ensureSessionConnected(page).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(TvError);
    expect((error as TvError).code).toBe('SESSION_DISCONNECTED');
    expect((error as TvError).message).toMatch(/click Connect in the dedicated Chrome window/);
    expect((error as TvError).message).toMatch(/ends the other session/);
    expect((error as TvError).message).toMatch(/never clicks it/);
  });

  it('treats an unreadable body as not disconnected (other guards still apply)', async () => {
    const page = fakePage(async () => {
      throw new Error('Execution context was destroyed');
    });
    expect(await isSessionDisconnected(page)).toBe(false);
    await expect(ensureSessionConnected(page)).resolves.toBeUndefined();
  });

  it('does not wait on a hung evaluate', async () => {
    const page = fakePage(() => new Promise(() => undefined));
    const started = Date.now();
    expect(await isSessionDisconnected(page, 50)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

// A minimal DOM stand-in: elements match a selector when it is listed in `sel`.
type FakeNode = { nodeType: number; textContent?: string; childNodes?: FakeNode[]; matches?: (s: string) => boolean };
const text = (value: string): FakeNode => ({ nodeType: 3, textContent: value });
const el = (sel: string[], ...children: FakeNode[]): FakeNode => ({
  nodeType: 1,
  childNodes: children,
  matches: (selector: string) => sel.includes(selector),
});

async function withFakeDocument<T>(body: FakeNode, run: () => Promise<T>): Promise<T> {
  const holder = globalThis as { document?: unknown };
  const saved = holder.document;
  holder.document = { body };
  try {
    return await run();
  } finally {
    holder.document = saved;
  }
}

// Runs the real in-page function against the fake document, like page.evaluate would.
const domPage = { evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg) } as unknown as Page;

describe('collectPageText and the guard on a fake DOM', () => {
  it('skips the editor, the logs and scripts but keeps the rest in document order', async () => {
    const body = el(
      [],
      text('Chart'),
      el(['.monaco-editor'], text('editor secret')),
      el(['script'], text('code')),
      el([], text('Modal'), el(['.widgetbar-widget-pine_logs'], text('log line')), text('end')),
    );
    expect(await withFakeDocument(body, async () => collectPageText([...SESSION_TEXT_EXCLUDED]))).toBe('Chart Modal end');
  });

  it('does not fire when only editor or Pine logs text contains the modal phrases', async () => {
    const body = el(
      [],
      text('EURUSD'),
      el(['[data-name="pine-dialog"]'], el(['.monaco-editor'], text(`// ${REAL_TEXT}`))),
      el(['[data-test-id-widget-type="pine_logs"]'], text(REAL_TEXT)),
    );
    expect(await withFakeDocument(body, () => isSessionDisconnected(domPage))).toBe(false);
  });

  it('fires on the real modal text outside the excluded areas', async () => {
    const body = el([], text('EURUSD'), el(['[role="dialog"]'], text('Session disconnected'), text(REAL_TEXT.slice(21))));
    expect(await withFakeDocument(body, () => isSessionDisconnected(domPage))).toBe(true);
  });
});
