# TradingView Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An MCP server (stdio) that lets Claude write a Pine Script into TradingView's Pine Editor in a dedicated Chrome, compile it, and verify compile errors, runtime errors, Strategy Tester stats/trades, Pine logs and chart screenshots.

**Architecture:** Pure parsers and pure logic (layout planning, ownership, polling) are unit-tested with Vitest against real text captured in the spike. A thin Playwright driver (`connectOverCDP` to Chrome on 127.0.0.1:9222) performs page interaction, verified by an incremental live smoke script. An MCP wiring layer maps driver methods to tools and is tested over an in-memory MCP transport with a fake driver.

**Tech Stack:** Node 22, TypeScript (strict, NodeNext), `playwright-core`, `@modelcontextprotocol/sdk`, `zod`, Vitest, `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-17-tradingview-bridge-design.md` (approved). Evidence: `spike/FINDINGS.md`.

## Global Constraints

- CDP endpoint bound to `127.0.0.1` (loopback only); dedicated Chrome profile used for TradingView only.
- Write source into the editor by **clipboard paste only** (`Ctrl+A`, `Ctrl+V`); never `keyboard.insertText`/typing (Monaco auto-indent corrupts code). `window.monaco` is not exposed.
- Every tool returns `{ok: true, ...}` or `{ok: false, error: {code, message, details?}}` and never blocks indefinitely (explicit timeouts).
- Error codes: `NOT_CONNECTED`, `NOT_LOGGED_IN`, `NO_CHART`, `UNEXPECTED_DIALOG`, `LAYOUT_FAILED`, `TIMEOUT_COMPILE`, `TIMEOUT_REPORT`, `SELECTOR_MISSING`, `PASTE_MISMATCH`, `NOT_OWNED` (spec) plus `INVALID_ARGUMENT`, `REMOVE_FAILED`, `INTERNAL` (added by this plan).
- No code path for alerts, orders/trading/broker panels, watchlists, drawings, publishing, or touching indicators the bridge did not add. Never right-click the chart; never click by blind coordinates.
- A dialog the bridge did not trigger is never auto-accepted.
- Immutability: build new objects, never mutate inputs; functions under 50 lines; files under 400 lines.
- Parsers and logic modules need 80%+ coverage (statements, branches, functions, lines).
- Relative imports use the `.js` extension (NodeNext).
- Git commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (second `-m`).

## Scope notes (deltas from the spec, all flagged for the user)

- **Deferred to a follow-up plan:** `tv_set_inputs` and `tv_read_data_window` (their dialog/DOM structure has not been probed). Claude can change inputs by editing `input.*` defaults in the source; per-bar values come from Pine logs.
- `tv_compile` payload uses `compiled: boolean` (the tool-level `ok` means the call itself succeeded).
- Runtime error info is the code (e.g. `RE10045`) plus the raw legend title; the underlying message text is not in the title.
- `tv_read_pine_logs` returns `[{time, text}]` (no `level`: level markup has not been observed).
- `tv_screenshot` captures the viewport (editor overlay occupies the right side).
- `tv_status.interval` is the chart's human label (e.g. `1 hour`).
- `tv_set_script` replaces whatever is in the editor; open a scratch script first.

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .gitignore, README.md
scripts/launch-chrome.ps1
src/result.ts                 error codes, TvError, ToolResult helpers
src/config.ts                 loopback-only CDP endpoint resolution
src/selectors.ts              every selector and UI text constant
src/parsers/numbers.ts        normalizeText, parseNumber/Money/Percent
src/parsers/source.ts         extractScriptTitle, sourcesEqual
src/parsers/console.ts        console entries, problem codes, compile outcome
src/parsers/runtime.ts        legend runtime-error status
src/parsers/strategy.ts       Key stats, trade rows
src/parsers/logs.ts           Pine log lines
src/parsers/chart.ts          chart canvas aria-label
src/driver/waits.ts           pollUntil (injectable clock)
src/driver/layout.ts          layout detection/plan/ensure (pure, injected ops)
src/driver/ownership.ts       which legend row the bridge owns (pure)
src/driver/types.ts           DriverApi and payload types
src/driver/connection.ts      connect over CDP, find chart tab
src/driver/pageLayoutOps.ts   Playwright implementation of LayoutOps
src/driver/editor.ts          paste/copy source, read console
src/driver/legend.ts          legend rows, status, removal
src/driver/compile.ts         compile orchestration
src/driver/strategyReader.ts  Key stats + trades from the Strategy Tester
src/driver/logsReader.ts      Pine logs from the split layout
src/driver/chart.ts           status helpers, screenshot, navigation
src/driver/selftest.ts        selector self-test
src/driver/driver.ts          TvDriver (implements DriverApi)
src/driver/provider.ts        lazy connect/reconnect
src/mcp.ts                    tool registration
src/server.ts                 stdio entry point
test/**                       unit tests, fixtures, live-smoke.ts
```

---

### Task 1: Project scaffold, git, result types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/result.ts`
- Test: `test/result.test.ts`

**Interfaces:**
- Produces: `ERROR_CODES`, `ErrorCode`, `class TvError(code, message, details?)`, `ErrorInfo`, `Failure`, `ToolResult<T>`, `toFailure(e: unknown): Failure`, `toResult<T extends object>(fn: () => Promise<T>): Promise<ToolResult<T>>`

- [ ] **Step 1: Initialise git and write project files**

Run (project root `D:\TradeBots\BrowserAI`): `git init -b main`

`.gitignore`:
```
node_modules/
dist/
coverage/
.chrome-profile/
spike/.chrome-profile/
spike/node_modules/
*.png
.env
```

`package.json`:
```json
{
  "name": "tradingview-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "start": "tsx src/server.ts",
    "smoke": "tsx test/live-smoke.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "playwright-core": "^1.49.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@vitest/coverage-v8": "^2.1.8",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/parsers/**',
        'src/result.ts',
        'src/config.ts',
        'src/driver/waits.ts',
        'src/driver/layout.ts',
        'src/driver/ownership.ts',
        'src/driver/selftest.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
```

Run: `npm install`
Run: `git status --short`
Expected: no line mentions `.chrome-profile`, `node_modules`, or `.png` (secrets and binaries are ignored).

- [ ] **Step 2: Write the failing test**

`test/result.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TvError, toFailure, toResult } from '../src/result.js';

describe('result helpers', () => {
  it('maps TvError to a failure with code, message and details', () => {
    const failure = toFailure(new TvError('NO_CHART', 'no chart', { url: 'x' }));
    expect(failure).toEqual({
      ok: false,
      error: { code: 'NO_CHART', message: 'no chart', details: { url: 'x' } },
    });
  });

  it('omits details when the TvError has none', () => {
    const failure = toFailure(new TvError('NOT_CONNECTED', 'down'));
    expect(failure).toEqual({ ok: false, error: { code: 'NOT_CONNECTED', message: 'down' } });
  });

  it('maps unknown Errors to INTERNAL', () => {
    expect(toFailure(new Error('boom'))).toEqual({
      ok: false,
      error: { code: 'INTERNAL', message: 'boom' },
    });
  });

  it('maps non-Error throwables to INTERNAL with a string message', () => {
    expect(toFailure('oops')).toEqual({ ok: false, error: { code: 'INTERNAL', message: 'oops' } });
  });

  it('toResult spreads the data after ok:true', async () => {
    expect(await toResult(async () => ({ a: 1 }))).toEqual({ ok: true, a: 1 });
  });

  it('toResult converts a thrown TvError into a failure', async () => {
    const result = await toResult(async () => {
      throw new TvError('TIMEOUT_REPORT', 'slow');
    });
    expect(result).toEqual({ ok: false, error: { code: 'TIMEOUT_REPORT', message: 'slow' } });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/result.test.ts`
Expected: FAIL, `Cannot find module '../src/result.js'`.

- [ ] **Step 4: Write minimal implementation**

`src/result.ts`:
```ts
export const ERROR_CODES = [
  'NOT_CONNECTED',
  'NOT_LOGGED_IN',
  'NO_CHART',
  'UNEXPECTED_DIALOG',
  'LAYOUT_FAILED',
  'TIMEOUT_COMPILE',
  'TIMEOUT_REPORT',
  'SELECTOR_MISSING',
  'PASTE_MISMATCH',
  'NOT_OWNED',
  'INVALID_ARGUMENT',
  'REMOVE_FAILED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class TvError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'TvError';
    this.code = code;
    this.details = details;
  }
}

export interface ErrorInfo {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export type Failure = { readonly ok: false; readonly error: ErrorInfo };
export type Success<T extends object> = { readonly ok: true } & T;
export type ToolResult<T extends object> = Success<T> | Failure;

export function toFailure(error: unknown): Failure {
  if (error instanceof TvError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: { code: 'INTERNAL', message } };
}

export async function toResult<T extends object>(fn: () => Promise<T>): Promise<ToolResult<T>> {
  try {
    const data = await fn();
    return { ok: true, ...data };
  } catch (error) {
    return toFailure(error);
  }
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run test/result.test.ts && npm run typecheck`
Expected: 6 tests PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold project, add result/error types" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Loopback-only CDP endpoint config

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: `TvError` from `src/result.ts`
- Produces: `DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222'`, `resolveCdpEndpoint(env?: Record<string, string | undefined>): string`

- [ ] **Step 1: Write the failing test**

`test/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { resolveCdpEndpoint, DEFAULT_CDP_ENDPOINT } from '../src/config.js';
import { TvError } from '../src/result.js';

describe('resolveCdpEndpoint', () => {
  it('defaults to loopback 9222', () => {
    expect(resolveCdpEndpoint({})).toBe(DEFAULT_CDP_ENDPOINT);
  });

  it('accepts a custom loopback port', () => {
    expect(resolveCdpEndpoint({ TV_CDP_ENDPOINT: 'http://localhost:9333' })).toBe('http://localhost:9333');
  });

  it('accepts IPv6 loopback', () => {
    expect(resolveCdpEndpoint({ TV_CDP_ENDPOINT: 'http://[::1]:9222' })).toBe('http://[::1]:9222');
  });

  it('strips any path from the endpoint', () => {
    expect(resolveCdpEndpoint({ TV_CDP_ENDPOINT: 'http://127.0.0.1:9222/json/version' })).toBe(
      'http://127.0.0.1:9222',
    );
  });

  it('rejects a non-loopback host', () => {
    expect(() => resolveCdpEndpoint({ TV_CDP_ENDPOINT: 'http://192.168.1.5:9222' })).toThrowError(TvError);
  });

  it('rejects an invalid URL', () => {
    expect(() => resolveCdpEndpoint({ TV_CDP_ENDPOINT: 'not a url' })).toThrowError(/not a valid URL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL, cannot find `../src/config.js`.

- [ ] **Step 3: Write minimal implementation**

`src/config.ts`:
```ts
import { TvError } from './result.js';

export const DEFAULT_CDP_ENDPOINT = 'http://127.0.0.1:9222';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function resolveCdpEndpoint(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.TV_CDP_ENDPOINT ?? DEFAULT_CDP_ENDPOINT;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TvError('INVALID_ARGUMENT', `TV_CDP_ENDPOINT is not a valid URL: ${raw}`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new TvError(
      'INVALID_ARGUMENT',
      `CDP endpoint must be loopback (127.0.0.1, localhost or [::1]), got ${url.hostname}`,
    );
  }
  return `${url.protocol}//${url.host}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat: loopback-only CDP endpoint resolution" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Number and source parsers

**Files:**
- Create: `src/parsers/numbers.ts`, `src/parsers/source.ts`
- Test: `test/parsers/numbers.test.ts`, `test/parsers/source.test.ts`

**Interfaces:**
- Produces (`numbers.ts`): `normalizeText(s: string): string` (nbsp to space, U+2212/2012/2013 to `-`, collapse whitespace, trim); `parseNumber(raw: string): number | null` (handles `,`, `+/-`, `K/M/B` suffix); `interface Money {value: number; unit: string}`; `parseMoney(raw: string): Money | null`; `parsePercent(raw: string): number | null`
- Produces (`source.ts`): `extractScriptTitle(source: string): string | null`; `normalizeSource(s: string): string`; `sourcesEqual(a: string, b: string): boolean`

- [ ] **Step 1: Write the failing tests**

`test/parsers/numbers.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeText, parseNumber, parseMoney, parsePercent } from '../../src/parsers/numbers.js';

describe('normalizeText', () => {
  it('converts nbsp and unicode minus and collapses whitespace', () => {
    expect(normalizeText('  \u221247.67\u00a0 USD\n\t x ')).toBe('-47.67 USD x');
  });
});

describe('parseNumber', () => {
  it('parses unicode minus with thousands separators', () => {
    expect(parseNumber('\u22121,234.56')).toBe(-1234.56);
  });
  it('parses an explicit plus sign', () => {
    expect(parseNumber('+7.95')).toBe(7.95);
  });
  it('expands K and M suffixes with or without a space', () => {
    expect(parseNumber('9.25 K')).toBe(9250);
    expect(parseNumber('10.38K')).toBe(10380);
    expect(parseNumber('1.5M')).toBe(1500000);
  });
  it('returns null for non-numbers', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('\u2014')).toBeNull();
  });
});

describe('parseMoney', () => {
  it('parses signed amounts with a currency unit', () => {
    expect(parseMoney('\u221247.67 USD')).toEqual({ value: -47.67, unit: 'USD' });
  });
  it('parses a magnitude suffix glued to the unit', () => {
    expect(parseMoney('10.43 KUSD')).toEqual({ value: 10430, unit: 'USD' });
  });
  it('returns null without a unit', () => {
    expect(parseMoney('12')).toBeNull();
  });
});

describe('parsePercent', () => {
  it('parses plain and spaced percents', () => {
    expect(parsePercent('34.01%')).toBe(34.01);
    expect(parsePercent('\u22120.46 %')).toBe(-0.46);
  });
  it('returns null for a dash', () => {
    expect(parsePercent('\u2014')).toBeNull();
  });
});
```

`test/parsers/source.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { extractScriptTitle, sourcesEqual } from '../../src/parsers/source.js';

describe('extractScriptTitle', () => {
  it('reads an indicator title', () => {
    expect(extractScriptTitle('//@version=6\nindicator("Spike runtime")\nplot(close)')).toBe('Spike runtime');
  });
  it('reads a strategy title followed by options', () => {
    expect(extractScriptTitle('strategy("Spike strat", overlay=true, initial_capital=10000)')).toBe('Spike strat');
  });
  it('reads a named title argument and single quotes', () => {
    expect(extractScriptTitle("indicator(title='My Ind', overlay=true)")).toBe('My Ind');
  });
  it('unescapes escaped quotes', () => {
    expect(extractScriptTitle('indicator("Say \\"hi\\"")')).toBe('Say "hi"');
  });
  it('returns null when there is no declaration', () => {
    expect(extractScriptTitle('plot(close)')).toBeNull();
  });
});

describe('sourcesEqual', () => {
  it('ignores CRLF line endings and trailing newlines', () => {
    expect(sourcesEqual('a\nb\n', 'a\r\nb\r\n')).toBe(true);
  });
  it('treats non-breaking spaces as spaces', () => {
    expect(sourcesEqual('a b', 'a\u00a0b')).toBe(true);
  });
  it('detects real differences', () => {
    expect(sourcesEqual('a\n    b', 'a\n  b')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/parsers`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write minimal implementation**

`src/parsers/numbers.ts`:
```ts
const MINUS_VARIANTS = /[\u2212\u2012\u2013]/g;
const SUFFIX: Readonly<Record<string, number>> = { K: 1e3, M: 1e6, B: 1e9 };

export interface Money {
  readonly value: number;
  readonly unit: string;
}

export function normalizeText(input: string): string {
  return input.replace(/\u00a0/g, ' ').replace(MINUS_VARIANTS, '-').replace(/\s+/g, ' ').trim();
}

export function parseNumber(raw: string): number | null {
  const text = normalizeText(raw).replace(/,/g, '');
  const match = /^([+-]?\d*\.?\d+)\s*([KMB])?$/i.exec(text);
  if (!match) return null;
  const multiplier = match[2] ? SUFFIX[match[2].toUpperCase()]! : 1;
  return Number((Number(match[1]) * multiplier).toPrecision(12));
}

export function parseMoney(raw: string): Money | null {
  const text = normalizeText(raw);
  const match = /^([+-]?[\d,]*\.?\d+)\s*([KMB])?\s*([A-Z]{3,5})$/.exec(text);
  if (!match) return null;
  const value = parseNumber(`${match[1]}${match[2] ?? ''}`);
  return value === null ? null : { value, unit: match[3]! };
}

export function parsePercent(raw: string): number | null {
  const match = /^([+-]?\d*\.?\d+)\s*%$/.exec(normalizeText(raw));
  return match ? parseNumber(match[1]!) : null;
}
```

`src/parsers/source.ts`:
```ts
const TITLE_PATTERN =
  /\b(?:indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?(["'])((?:(?!\1)[^\\]|\\.)*)\1/;

export function extractScriptTitle(source: string): string | null {
  const match = TITLE_PATTERN.exec(source);
  return match ? match[2]!.replace(/\\(["'\\])/g, '$1') : null;
}

export function normalizeSource(source: string): string {
  return source.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trimEnd();
}

export function sourcesEqual(a: string, b: string): boolean {
  return normalizeSource(a) === normalizeSource(b);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/parsers`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parsers test/parsers
git commit -m "feat: number and source parsers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Console, problem-code and runtime-status parsers

**Files:**
- Create: `src/parsers/console.ts`, `src/parsers/runtime.ts`
- Test: `test/parsers/console.test.ts`, `test/parsers/runtime.test.ts`

**Interfaces:**
- Consumes: `normalizeText` from `src/parsers/numbers.ts`
- Produces (`console.ts`): `ConsoleEntry {time, message}`, `ProblemCode {message, code}`, `CompileProblem {line, column, message, code?}`, `CompileOutcome {finished, compiled, action: 'added'|'updated'|null, errors, warnings}`, `parseConsoleEntries(panelText: string): ConsoleEntry[]`, `parseProblemCodes(panelText: string): ProblemCode[]`, `analyzeCompile(entries: readonly ConsoleEntry[], codes?: readonly ProblemCode[]): CompileOutcome`
- Produces (`runtime.ts`): `RuntimeError {present, code?, raw?}`, `parseRuntimeStatus(title: string | null | undefined): RuntimeError`

- [ ] **Step 1: Write the failing tests**

`test/parsers/console.test.ts` (inputs are real console text from the spike):
```ts
import { describe, it, expect } from 'vitest';
import { parseConsoleEntries, parseProblemCodes, analyzeCompile } from '../../src/parsers/console.js';

const PANEL = [
  'Pine Editor',
  'Untitled script',
  '1 of 1 problem',
  'Syntax error at input ")"(CE10156)',
  '12:57:39 PM\t"Untitled script" opened',
  '1:02:05 PM\tCompiling...',
  '1:02:05 PM\tCompiled.',
  '1:02:05 PM\tUpdated on chart.',
  '1:01:44 PM\tError at 7:16 Syntax error at input ")"',
  'Line 7, Col 16',
  'Pine Script\u00ae v6',
].join('\n');

describe('parseConsoleEntries', () => {
  it('keeps only timestamped console lines', () => {
    const entries = parseConsoleEntries(PANEL);
    expect(entries.map((e) => e.message)).toEqual([
      '"Untitled script" opened',
      'Compiling...',
      'Compiled.',
      'Updated on chart.',
      'Error at 7:16 Syntax error at input ")"',
    ]);
    expect(entries[0]!.time).toBe('12:57:39 PM');
  });
});

describe('parseProblemCodes', () => {
  it('extracts message and code from the problems list', () => {
    expect(parseProblemCodes(PANEL)).toEqual([{ message: 'Syntax error at input ")"', code: 'CE10156' }]);
  });
});

describe('analyzeCompile', () => {
  const entry = (message: string) => ({ time: '1:00:00 PM', message });

  it('reports a first add as added', () => {
    const outcome = analyzeCompile([entry('Compiling...'), entry('Compiled.'), entry('Added to chart.')]);
    expect(outcome).toMatchObject({ finished: true, compiled: true, action: 'added', errors: [] });
  });

  it('reports a re-run as updated', () => {
    const outcome = analyzeCompile([entry('Compiling...'), entry('Compiled.'), entry('Updated on chart.')]);
    expect(outcome.action).toBe('updated');
  });

  it('parses an error with its problem code', () => {
    const outcome = analyzeCompile(
      [entry('Compiling...'), entry('Error at 7:16 Syntax error at input ")"')],
      [{ message: 'Syntax error at input ")"', code: 'CE10156' }],
    );
    expect(outcome.finished).toBe(true);
    expect(outcome.compiled).toBe(false);
    expect(outcome.errors).toEqual([
      { line: 7, column: 16, message: 'Syntax error at input ")"', code: 'CE10156' },
    ]);
  });

  it('omits code when the problems list has no match', () => {
    const outcome = analyzeCompile([entry('Error at 1:1 boom')]);
    expect(outcome.errors).toEqual([{ line: 1, column: 1, message: 'boom' }]);
  });

  it('is not finished while only Compiling... is present', () => {
    expect(analyzeCompile([entry('Compiling...')]).finished).toBe(false);
  });

  it('is not finished when compiled but not yet added or updated', () => {
    expect(analyzeCompile([entry('Compiling...'), entry('Compiled.')]).finished).toBe(false);
  });

  it('collects warnings (format assumed, not yet observed live)', () => {
    const outcome = analyzeCompile([entry('Compiled.'), entry('Warning at 3:4 careful'), entry('Added to chart.')]);
    expect(outcome.warnings).toEqual([{ line: 3, column: 4, message: 'careful' }]);
  });
});
```

`test/parsers/runtime.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseRuntimeStatus } from '../../src/parsers/runtime.js';

describe('parseRuntimeStatus', () => {
  it('extracts the runtime error code from the legend title', () => {
    expect(parseRuntimeStatus('Runtime error: RE10045 \u00b7 Opened in Pine Editor')).toEqual({
      present: true,
      code: 'RE10045',
      raw: 'Runtime error: RE10045 \u00b7 Opened in Pine Editor',
    });
  });
  it('reports no error for a missing title', () => {
    expect(parseRuntimeStatus(null)).toEqual({ present: false });
    expect(parseRuntimeStatus(undefined)).toEqual({ present: false });
  });
  it('does not treat other statuses as runtime errors', () => {
    expect(parseRuntimeStatus('Some other status')).toEqual({ present: false, raw: 'Some other status' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/parsers/console.test.ts test/parsers/runtime.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write minimal implementation**

`src/parsers/console.ts`:
```ts
import { normalizeText } from './numbers.js';

export interface ConsoleEntry {
  readonly time: string;
  readonly message: string;
}
export interface ProblemCode {
  readonly message: string;
  readonly code: string;
}
export interface CompileProblem {
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly code?: string;
}
export interface CompileOutcome {
  readonly finished: boolean;
  readonly compiled: boolean;
  readonly action: 'added' | 'updated' | null;
  readonly errors: readonly CompileProblem[];
  readonly warnings: readonly CompileProblem[];
}

const CONSOLE_LINE = /^(\d{1,2}:\d{2}:\d{2} [AP]M) (.+)$/;
const PROBLEM_CODE_LINE = /^(.*)\(([A-Z]{2}\d{4,6})\)$/;
const ERROR_ENTRY = /^Error at (\d+):(\d+) (.*)$/;
const WARNING_ENTRY = /^Warning at (\d+):(\d+) (.*)$/; // format assumed; not yet observed live

export function parseConsoleEntries(panelText: string): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  for (const line of panelText.split('\n')) {
    const match = CONSOLE_LINE.exec(normalizeText(line));
    if (match) entries.push({ time: match[1]!, message: match[2]! });
  }
  return entries;
}

export function parseProblemCodes(panelText: string): ProblemCode[] {
  const codes: ProblemCode[] = [];
  for (const line of panelText.split('\n')) {
    const match = PROBLEM_CODE_LINE.exec(normalizeText(line));
    if (match && match[1]!.trim()) codes.push({ message: match[1]!.trim(), code: match[2]! });
  }
  return codes;
}

function toProblem(match: RegExpExecArray, codes: readonly ProblemCode[]): CompileProblem {
  const message = match[3]!;
  const code = codes.find((c) => c.message === message)?.code;
  return { line: Number(match[1]), column: Number(match[2]), message, ...(code ? { code } : {}) };
}

function collect(messages: readonly string[], pattern: RegExp, codes: readonly ProblemCode[]): CompileProblem[] {
  return messages
    .map((m) => pattern.exec(m))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => toProblem(m, codes));
}

export function analyzeCompile(
  entries: readonly ConsoleEntry[],
  codes: readonly ProblemCode[] = [],
): CompileOutcome {
  const messages = entries.map((e) => e.message);
  const errors = collect(messages, ERROR_ENTRY, codes);
  const warnings = collect(messages, WARNING_ENTRY, codes);
  const compiled = messages.includes('Compiled.');
  const action = messages.includes('Added to chart.')
    ? 'added'
    : messages.includes('Updated on chart.')
      ? 'updated'
      : null;
  const finished = errors.length > 0 || (compiled && action !== null);
  return { finished, compiled, action, errors, warnings };
}
```

`src/parsers/runtime.ts`:
```ts
import { normalizeText } from './numbers.js';

export interface RuntimeError {
  readonly present: boolean;
  readonly code?: string;
  readonly raw?: string;
}

const RUNTIME_ERROR = /^Runtime error:\s*([A-Z]{2}\d+)/;

export function parseRuntimeStatus(title: string | null | undefined): RuntimeError {
  if (!title) return { present: false };
  const match = RUNTIME_ERROR.exec(normalizeText(title));
  if (!match) return { present: false, raw: title };
  return { present: true, code: match[1]!, raw: title };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/parsers/console.test.ts test/parsers/runtime.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parsers test/parsers
git commit -m "feat: console, problem-code and runtime-status parsers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Strategy Tester parsers (Key stats, trades)

**Files:**
- Create: `src/parsers/strategy.ts`
- Test: `test/parsers/strategy.test.ts`

**Interfaces:**
- Consumes: `normalizeText`, `parseNumber` from `src/parsers/numbers.ts`
- Produces: `MoneyWithPercent {value, unit, percent: number | null}`, `KeyStats {totalPnl, maxDrawdown: MoneyWithPercent | null; profitableTrades: {percent, wins, total} | null; profitFactor: number | null}`, `parseKeyStats(raw: string): KeyStats`, `Trade {number, side: 'Long'|'Short', entryTime, exitTime: string | null, entryPrice, exitPrice: number | null, size, netPnl: {value, unit}, returnPercent: number | null}`, `parseTradeRows(rows: readonly string[]): {trades: Trade[]; unparsed: number}`

Note: Key stats text below is reconstructed from the spike screenshot (real values, normalised whitespace); the parser normalises whitespace so the live smoke test (Task 11) confirms real `innerText`. Trade rows are real captured text.

- [ ] **Step 1: Write the failing test**

`test/parsers/strategy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseKeyStats, parseTradeRows } from '../../src/parsers/strategy.js';

const KEY_STATS =
  'Key stats Total PnL +391.32 USD +3.91% Max drawdown 698.36 USD 6.32% ' +
  'Profitable trades 34.01% 67/197 Profit factor 1.131 Performance Cumulative PnL';

describe('parseKeyStats', () => {
  it('parses all four key stats', () => {
    expect(parseKeyStats(KEY_STATS)).toEqual({
      totalPnl: { value: 391.32, unit: 'USD', percent: 3.91 },
      maxDrawdown: { value: 698.36, unit: 'USD', percent: 6.32 },
      profitableTrades: { percent: 34.01, wins: 67, total: 197 },
      profitFactor: 1.131,
    });
  });

  it('handles unicode minus and splits across lines', () => {
    const text = 'Total PnL\n\u2212120.50\nUSD\n\u22121.20%\nMax drawdown 5 USD 0.1% Profit factor 0.9';
    expect(parseKeyStats(text).totalPnl).toEqual({ value: -120.5, unit: 'USD', percent: -1.2 });
  });

  it('returns nulls for missing sections', () => {
    expect(parseKeyStats('nothing here')).toEqual({
      totalPnl: null,
      maxDrawdown: null,
      profitableTrades: null,
      profitFactor: null,
    });
  });
});

const OPEN_ROW =
  '198Long Exit Entry Open Oct 15, 2026, 08:00 \u2014 1.12282 USD 9.25 K 10.38 KUSD +7.95 USD \u2014';
const CLOSED_LOSS =
  '197Long Exit Entry Oct 14, 2026, 17:00 Oct 13, 2026, 14:00 1.11291 USD 1.11802 USD 9.33 K 10.43 KUSD \u221247.67 USD \u22120.46%';
const CLOSED_LOSS_2 =
  '196Long Exit Entry Oct 9, 2026, 21:00 Oct 9, 2026, 00:00 1.11900 USD 1.12137 USD 9.32 K 10.45 KUSD \u221222.09 USD \u22120.21%';

describe('parseTradeRows', () => {
  it('parses a closed trade', () => {
    const { trades, unparsed } = parseTradeRows([CLOSED_LOSS]);
    expect(unparsed).toBe(0);
    expect(trades[0]).toEqual({
      number: 197,
      side: 'Long',
      entryTime: 'Oct 13, 2026, 14:00',
      exitTime: 'Oct 14, 2026, 17:00',
      entryPrice: 1.11802,
      exitPrice: 1.11291,
      size: 9330,
      netPnl: { value: -47.67, unit: 'USD' },
      returnPercent: -0.46,
    });
  });

  it('parses an open trade with null exit fields', () => {
    const { trades } = parseTradeRows([OPEN_ROW]);
    expect(trades[0]).toEqual({
      number: 198,
      side: 'Long',
      entryTime: 'Oct 15, 2026, 08:00',
      exitTime: null,
      entryPrice: 1.12282,
      exitPrice: null,
      size: 9250,
      netPnl: { value: 7.95, unit: 'USD' },
      returnPercent: null,
    });
  });

  it('ignores header and empty rows, counts unparseable trade rows', () => {
    const rows = ['Trade number Type Date and time Price Size Net PnL Return', '', OPEN_ROW, CLOSED_LOSS_2, '5Long garbage'];
    const { trades, unparsed } = parseTradeRows(rows);
    expect(trades.map((t) => t.number)).toEqual([198, 196]);
    expect(unparsed).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/parsers/strategy.test.ts`
Expected: FAIL, cannot find `../../src/parsers/strategy.js`.

- [ ] **Step 3: Write minimal implementation**

`src/parsers/strategy.ts`:
```ts
import { normalizeText, parseNumber } from './numbers.js';

export interface MoneyWithPercent {
  readonly value: number;
  readonly unit: string;
  readonly percent: number | null;
}
export interface KeyStats {
  readonly totalPnl: MoneyWithPercent | null;
  readonly maxDrawdown: MoneyWithPercent | null;
  readonly profitableTrades: { readonly percent: number; readonly wins: number; readonly total: number } | null;
  readonly profitFactor: number | null;
}
export interface Trade {
  readonly number: number;
  readonly side: 'Long' | 'Short';
  readonly entryTime: string;
  readonly exitTime: string | null;
  readonly entryPrice: number;
  readonly exitPrice: number | null;
  readonly size: number;
  readonly netPnl: { readonly value: number; readonly unit: string };
  readonly returnPercent: number | null;
}

const LABELS = ['Total PnL', 'Max drawdown', 'Profitable trades', 'Profit factor'] as const;
const END_MARKERS = ['Performance'] as const;
const MONEY = /([+-]?[\d,]*\.?\d+)\s*([A-Z]{3})\b/;
const PERCENT = /([+-]?\d*\.?\d+)\s*%/;
const RATIO = /(\d+)\s*\/\s*(\d+)/;
const PLAIN = /([+-]?[\d,]*\.?\d+)/;

function sectionAfter(text: string, label: string): string | null {
  const start = text.indexOf(label);
  if (start < 0) return null;
  const from = start + label.length;
  const stops = [...LABELS.filter((l) => l !== label), ...END_MARKERS]
    .map((l) => text.indexOf(l, from))
    .filter((i) => i >= 0);
  return text.slice(from, stops.length > 0 ? Math.min(...stops) : text.length).trim();
}

function moneyWithPercent(section: string | null): MoneyWithPercent | null {
  if (!section) return null;
  const money = MONEY.exec(section);
  const value = money ? parseNumber(money[1]!) : null;
  if (!money || value === null) return null;
  const percent = PERCENT.exec(section);
  return { value, unit: money[2]!, percent: percent ? parseNumber(percent[1]!) : null };
}

function profitable(section: string | null): KeyStats['profitableTrades'] {
  if (!section) return null;
  const percent = PERCENT.exec(section);
  const ratio = RATIO.exec(section);
  const value = percent ? parseNumber(percent[1]!) : null;
  if (value === null || !ratio) return null;
  return { percent: value, wins: Number(ratio[1]), total: Number(ratio[2]) };
}

export function parseKeyStats(raw: string): KeyStats {
  const text = normalizeText(raw);
  const factor = sectionAfter(text, 'Profit factor');
  const factorMatch = factor ? PLAIN.exec(factor) : null;
  return {
    totalPnl: moneyWithPercent(sectionAfter(text, 'Total PnL')),
    maxDrawdown: moneyWithPercent(sectionAfter(text, 'Max drawdown')),
    profitableTrades: profitable(sectionAfter(text, 'Profitable trades')),
    profitFactor: factorMatch ? parseNumber(factorMatch[1]!) : null,
  };
}

const DATE = String.raw`[A-Z][a-z]{2} \d{1,2}, \d{4}, \d{2}:\d{2}`;
const NUM = String.raw`[+-]?[\d,]*\.?\d+`;
const CCY = String.raw`[A-Z]{3}`;
const SIZE = String.raw`(${NUM})(?: ([KMB]))?`;
const VALUE = String.raw`${NUM} ?[KMB]?${CCY}`;
const CLOSED = new RegExp(
  String.raw`^(\d+)(Long|Short) Exit Entry (${DATE}) (${DATE}) (${NUM}) ${CCY} (${NUM}) ${CCY} ${SIZE} ${VALUE} (${NUM}) (${CCY}) (${NUM})%$`,
);
const OPEN = new RegExp(
  String.raw`^(\d+)(Long|Short) Exit Entry Open (${DATE}) \u2014 (${NUM}) ${CCY} ${SIZE} ${VALUE} (${NUM}) (${CCY}) \u2014$`,
);
const TRADE_START = /^\d+(Long|Short)/;

function size(num: string, suffix: string | undefined): number {
  return parseNumber(`${num}${suffix ?? ''}`) ?? Number.NaN;
}

function parseClosed(m: RegExpExecArray): Trade {
  return {
    number: Number(m[1]),
    side: m[2] as Trade['side'],
    exitTime: m[3]!,
    entryTime: m[4]!,
    exitPrice: parseNumber(m[5]!),
    entryPrice: parseNumber(m[6]!)!,
    size: size(m[7]!, m[8]),
    netPnl: { value: parseNumber(m[9]!)!, unit: m[10]! },
    returnPercent: parseNumber(m[11]!),
  };
}

function parseOpen(m: RegExpExecArray): Trade {
  return {
    number: Number(m[1]),
    side: m[2] as Trade['side'],
    exitTime: null,
    entryTime: m[3]!,
    exitPrice: null,
    entryPrice: parseNumber(m[4]!)!,
    size: size(m[5]!, m[6]),
    netPnl: { value: parseNumber(m[7]!)!, unit: m[8]! },
    returnPercent: null,
  };
}

function parseTradeRow(text: string): Trade | null {
  const closed = CLOSED.exec(text);
  if (closed) return parseClosed(closed);
  const open = OPEN.exec(text);
  return open ? parseOpen(open) : null;
}

export function parseTradeRows(rows: readonly string[]): { trades: Trade[]; unparsed: number } {
  const trades: Trade[] = [];
  let unparsed = 0;
  for (const raw of rows) {
    const text = normalizeText(raw);
    if (!TRADE_START.test(text)) continue;
    const trade = parseTradeRow(text);
    if (trade) trades.push(trade);
    else unparsed += 1;
  }
  return { trades, unparsed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/parsers/strategy.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/strategy.ts test/parsers/strategy.test.ts
git commit -m "feat: Strategy Tester key stats and trade row parsers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Pine log and chart-label parsers

**Files:**
- Create: `src/parsers/logs.ts`, `src/parsers/chart.ts`
- Test: `test/parsers/logs.test.ts`, `test/parsers/chart.test.ts`

**Interfaces:**
- Produces: `PineLogLine {time, text}`, `parsePineLogs(lines: readonly string[]): PineLogLine[]`, `ChartLabel {symbol, interval}`, `parseChartLabel(label: string): ChartLabel | null`

- [ ] **Step 1: Write the failing tests**

`test/parsers/logs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parsePineLogs } from '../../src/parsers/logs.js';

describe('parsePineLogs', () => {
  it('parses a timestamped log line', () => {
    expect(parsePineLogs(['[2026-10-17T00:00:00.000+04:00]: last bar close=1.124 fast=1.124'])).toEqual([
      { time: '2026-10-17T00:00:00.000+04:00', text: 'last bar close=1.124 fast=1.124' },
    ]);
  });
  it('skips lines that are not log lines (e.g. "No data")', () => {
    expect(parsePineLogs(['No data', ''])).toEqual([]);
  });
});
```

`test/parsers/chart.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseChartLabel } from '../../src/parsers/chart.js';

describe('parseChartLabel', () => {
  it('splits symbol and interval', () => {
    expect(parseChartLabel('Chart for FX_IDC:EURUSD, 1 hour')).toEqual({
      symbol: 'FX_IDC:EURUSD',
      interval: '1 hour',
    });
  });
  it('returns null for unrelated labels', () => {
    expect(parseChartLabel('Something else')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/parsers/logs.test.ts test/parsers/chart.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write minimal implementation**

`src/parsers/logs.ts`:
```ts
import { normalizeText } from './numbers.js';

export interface PineLogLine {
  readonly time: string;
  readonly text: string;
}

const LOG_LINE = /^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]:\s?(.*)$/;

export function parsePineLogs(lines: readonly string[]): PineLogLine[] {
  const parsed: PineLogLine[] = [];
  for (const line of lines) {
    const match = LOG_LINE.exec(normalizeText(line));
    if (match) parsed.push({ time: match[1]!, text: match[2]! });
  }
  return parsed;
}
```

`src/parsers/chart.ts`:
```ts
export interface ChartLabel {
  readonly symbol: string;
  readonly interval: string;
}

const CHART_LABEL = /^Chart for (.+), ([^,]+)$/;

export function parseChartLabel(label: string): ChartLabel | null {
  const match = CHART_LABEL.exec(label.trim());
  return match ? { symbol: match[1]!, interval: match[2]!.trim() } : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/parsers && npm run typecheck`
Expected: all parser tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/parsers test/parsers
git commit -m "feat: Pine log and chart label parsers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pure driver logic (waits, layout planning, ownership)

**Files:**
- Create: `src/driver/waits.ts`, `src/driver/layout.ts`, `src/driver/ownership.ts`
- Test: `test/driver/waits.test.ts`, `test/driver/layout.test.ts`, `test/driver/ownership.test.ts`

**Interfaces:**
- Consumes: `TvError` from `src/result.ts`
- Produces (`waits.ts`): `PollOptions {timeoutMs, intervalMs?, now?, sleep?}`, `realSleep(ms): Promise<void>`, `pollUntil<T>(probe: () => Promise<T | null | undefined | false>, opts: PollOptions): Promise<T | null>` (returns first truthy probe value, or `null` on timeout; probe exceptions propagate)
- Produces (`layout.ts`): `LayoutMode = 'closed' | 'overlay' | 'split'`, `LayoutStep = 'openEditor' | 'openPineLogs' | 'toOverlay'`, `detectLayout(flags: {overlayVisible: boolean; splitVisible: boolean}): LayoutMode`, `planLayout(current: LayoutMode, required: 'overlay' | 'split'): LayoutStep[]`, `interface LayoutOps {detect(): Promise<LayoutMode>; run(step: LayoutStep): Promise<void>}`, `ensureLayout(ops: LayoutOps, required: 'overlay' | 'split', maxRounds?: number): Promise<LayoutMode>` (throws `LAYOUT_FAILED`)
- Produces (`ownership.ts`): `LegendRow {entityId, title}`, `pickOwnedEntity(args: {before: readonly LegendRow[]; after: readonly LegendRow[]; scriptTitle: string | null; previousOwned: string | null; action: 'added' | 'updated' | null}): string | null`

- [ ] **Step 1: Write the failing tests**

`test/driver/waits.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pollUntil } from '../../src/driver/waits.js';

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe('pollUntil', () => {
  it('returns immediately when the first probe is truthy', async () => {
    const clock = fakeClock();
    expect(await pollUntil(async () => 'ready', { timeoutMs: 1000, ...clock })).toBe('ready');
  });

  it('keeps probing until truthy', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollUntil(async () => (++calls === 3 ? 'ok' : null), {
      timeoutMs: 5000,
      intervalMs: 100,
      ...clock,
    });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('returns null after the timeout', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollUntil(async () => (calls++, null), {
      timeoutMs: 1000,
      intervalMs: 250,
      ...clock,
    });
    expect(result).toBeNull();
    expect(calls).toBe(5);
  });

  it('propagates probe errors', async () => {
    await expect(
      pollUntil(
        async () => {
          throw new Error('probe failed');
        },
        { timeoutMs: 100, ...fakeClock() },
      ),
    ).rejects.toThrow('probe failed');
  });
});
```

`test/driver/layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  detectLayout,
  planLayout,
  ensureLayout,
  type LayoutMode,
  type LayoutOps,
  type LayoutStep,
} from '../../src/driver/layout.js';
import { TvError } from '../../src/result.js';

function fakeOps(start: LayoutMode, stuck = false) {
  let mode = start;
  const steps: LayoutStep[] = [];
  const ops: LayoutOps = {
    detect: async () => mode,
    run: async (step) => {
      steps.push(step);
      if (stuck) return;
      mode = step === 'openPineLogs' ? 'split' : 'overlay';
    },
  };
  return { ops, steps };
}

describe('detectLayout', () => {
  it('prefers overlay, then split, else closed', () => {
    expect(detectLayout({ overlayVisible: true, splitVisible: true })).toBe('overlay');
    expect(detectLayout({ overlayVisible: false, splitVisible: true })).toBe('split');
    expect(detectLayout({ overlayVisible: false, splitVisible: false })).toBe('closed');
  });
});

describe('planLayout', () => {
  it('plans each transition', () => {
    expect(planLayout('overlay', 'overlay')).toEqual([]);
    expect(planLayout('closed', 'overlay')).toEqual(['openEditor']);
    expect(planLayout('split', 'overlay')).toEqual(['toOverlay']);
    expect(planLayout('overlay', 'split')).toEqual(['openPineLogs']);
    expect(planLayout('closed', 'split')).toEqual(['openEditor', 'openPineLogs']);
    expect(planLayout('split', 'split')).toEqual([]);
  });
});

describe('ensureLayout', () => {
  it('does nothing when already in the required layout', async () => {
    const { ops, steps } = fakeOps('overlay');
    expect(await ensureLayout(ops, 'overlay')).toBe('overlay');
    expect(steps).toEqual([]);
  });

  it('walks closed to split through overlay', async () => {
    const { ops, steps } = fakeOps('closed');
    expect(await ensureLayout(ops, 'split')).toBe('split');
    expect(steps).toEqual(['openEditor', 'openPineLogs']);
  });

  it('returns split to overlay', async () => {
    const { ops, steps } = fakeOps('split');
    await ensureLayout(ops, 'overlay');
    expect(steps).toEqual(['toOverlay']);
  });

  it('throws LAYOUT_FAILED when a step has no effect', async () => {
    const { ops } = fakeOps('overlay', true);
    await expect(ensureLayout(ops, 'split', 3)).rejects.toMatchObject({
      name: 'TvError',
      code: 'LAYOUT_FAILED',
    });
    await expect(ensureLayout(ops, 'split', 3)).rejects.toBeInstanceOf(TvError);
  });
});
```

`test/driver/ownership.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { pickOwnedEntity, type LegendRow } from '../../src/driver/ownership.js';

const row = (entityId: string, title: string): LegendRow => ({ entityId, title });

describe('pickOwnedEntity', () => {
  it('claims the single new row matching the script title', () => {
    const owned = pickOwnedEntity({
      before: [row('a', 'User Indicator')],
      after: [row('a', 'User Indicator'), row('b', 'Spike strat')],
      scriptTitle: 'Spike strat',
      previousOwned: null,
      action: 'added',
    });
    expect(owned).toBe('b');
  });

  it('keeps the previous owned row while it still matches', () => {
    const owned = pickOwnedEntity({
      before: [row('b', 'Spike strat')],
      after: [row('b', 'Spike strat 10 30')],
      scriptTitle: 'Spike strat',
      previousOwned: 'b',
      action: 'updated',
    });
    expect(owned).toBe('b');
  });

  it('on update with no history claims a single matching row', () => {
    const owned = pickOwnedEntity({
      before: [row('c', 'Spike strat')],
      after: [row('c', 'Spike strat')],
      scriptTitle: 'Spike strat',
      previousOwned: null,
      action: 'updated',
    });
    expect(owned).toBe('c');
  });

  it('does not claim a pre-existing same-titled row after an add', () => {
    const owned = pickOwnedEntity({
      before: [row('u', 'Spike strat')],
      after: [row('u', 'Spike strat'), row('n1', 'Spike strat'), row('n2', 'Spike strat')],
      scriptTitle: 'Spike strat',
      previousOwned: null,
      action: 'added',
    });
    expect(owned).toBeNull();
  });

  it('returns null when nothing matches or the title is unknown', () => {
    expect(
      pickOwnedEntity({ before: [], after: [row('a', 'Other')], scriptTitle: 'Spike', previousOwned: null, action: 'added' }),
    ).toBeNull();
    expect(
      pickOwnedEntity({ before: [], after: [row('a', 'Other')], scriptTitle: null, previousOwned: null, action: 'added' }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/driver`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write minimal implementation**

`src/driver/waits.ts`:
```ts
export interface PollOptions {
  readonly timeoutMs: number;
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function pollUntil<T>(
  probe: () => Promise<T | null | undefined | false>,
  options: PollOptions,
): Promise<T | null> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const interval = options.intervalMs ?? 250;
  const deadline = now() + options.timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (now() >= deadline) return null;
    await sleep(interval);
  }
}
```

`src/driver/layout.ts`:
```ts
import { TvError } from '../result.js';

export type LayoutMode = 'closed' | 'overlay' | 'split';
export type LayoutStep = 'openEditor' | 'openPineLogs' | 'toOverlay';

export interface LayoutOps {
  detect(): Promise<LayoutMode>;
  run(step: LayoutStep): Promise<void>;
}

export function detectLayout(flags: { overlayVisible: boolean; splitVisible: boolean }): LayoutMode {
  if (flags.overlayVisible) return 'overlay';
  if (flags.splitVisible) return 'split';
  return 'closed';
}

export function planLayout(current: LayoutMode, required: 'overlay' | 'split'): LayoutStep[] {
  if (current === required) return [];
  if (required === 'overlay') return current === 'closed' ? ['openEditor'] : ['toOverlay'];
  return current === 'closed' ? ['openEditor', 'openPineLogs'] : ['openPineLogs'];
}

export async function ensureLayout(
  ops: LayoutOps,
  required: 'overlay' | 'split',
  maxRounds = 4,
): Promise<LayoutMode> {
  for (let round = 0; round < maxRounds; round += 1) {
    const plan = planLayout(await ops.detect(), required);
    if (plan.length === 0) return required;
    await ops.run(plan[0]!);
  }
  const finalMode = await ops.detect();
  if (finalMode === required) return finalMode;
  throw new TvError('LAYOUT_FAILED', `Could not reach the ${required} layout; stuck at ${finalMode}`, {
    required,
    current: finalMode,
  });
}
```

`src/driver/ownership.ts`:
```ts
export interface LegendRow {
  readonly entityId: string;
  readonly title: string;
}

export interface OwnershipArgs {
  readonly before: readonly LegendRow[];
  readonly after: readonly LegendRow[];
  readonly scriptTitle: string | null;
  readonly previousOwned: string | null;
  readonly action: 'added' | 'updated' | null;
}

export function pickOwnedEntity(args: OwnershipArgs): string | null {
  if (!args.scriptTitle) return null;
  const title = args.scriptTitle;
  const matches = args.after.filter((row) => row.title.startsWith(title));
  if (args.previousOwned && matches.some((row) => row.entityId === args.previousOwned)) {
    return args.previousOwned;
  }
  const knownIds = new Set(args.before.map((row) => row.entityId));
  const fresh = matches.filter((row) => !knownIds.has(row.entityId));
  if (fresh.length === 1) return fresh[0]!.entityId;
  if (args.action === 'updated' && matches.length === 1) return matches[0]!.entityId;
  return null;
}
```

- [ ] **Step 4: Run tests and coverage check**

Run: `npx vitest run test/driver && npm run typecheck`
Expected: all PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/driver test/driver
git commit -m "feat: polling, layout planning and ownership logic" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Selectors, connection, Playwright layout ops, live smoke harness

**Files:**
- Create: `src/selectors.ts`, `src/driver/connection.ts`, `src/driver/pageLayoutOps.ts`
- Create: `scripts/launch-chrome.ps1`
- Create: `test/fixtures/pine.ts`, `test/live-smoke.ts`

**Interfaces:**
- Consumes: `LayoutOps`, `detectLayout` (layout.ts), `TvError`, `resolveCdpEndpoint`
- Produces: `SEL`, `TEXT` constants; `connect(endpoint?: string): Promise<{browser: Browser; page: Page}>`; `createPageLayoutOps(page: Page): LayoutOps`; `SOURCES` fixtures (`valid`, `broken`, `runtimeError`, `strategy`); live smoke runner `npm run smoke -- <section|all>`

This task has no unit tests (it needs a logged-in Chrome). Its deliverable is verified by the `layout` smoke section.

- [ ] **Step 1: Write `src/selectors.ts`**

```ts
export const SEL = {
  overlayRoot: '[data-name="pine-dialog"]',
  splitRoot: '#pine-editor-dialog',
  openEditorButton: '[data-name="pine-dialog-button"]',
  editorSurface: '.monaco-editor .view-lines',
  overlayMoreButton: '[data-name="pine-dialog"] button[title="More"]',
  toOverlayButton: 'button[title="Move split-view to overlay"]',
  chartCanvas: 'canvas[data-qa-id="pane-top-canvas"]',
  signInButton: '[data-name="header-user-menu-sign-in"]',
  legendRoot: '[data-qa-id="legend"]',
  legendItem: '[data-qa-id="legend-source-item"]',
  legendTitle: '[data-qa-id~="legend-source-title"]',
  legendStatus: '[data-qa-id="legend-source-item-status"]',
  legendDelete: '[data-qa-id="legend-delete-action"]',
  legendToggler: '[data-qa-id="legend-toggler"]',
  legendSources: '[data-qa-id="legend-sources-wrapper"]',
  reportTab: '[id="Strategy report"]',
  tradesTab: '[id="List of Trades"]',
} as const;

export const TEXT = {
  reportLabels: ['Total PnL', 'Profit factor'],
  splitDialogTitle: 'Split the view?',
  splitConfirm: 'Move editor to split-view',
  pineLogsMenu: 'Pine logs',
  helpCenter: 'Help Center',
} as const;
```

- [ ] **Step 2: Write `src/driver/connection.ts`**

```ts
import { chromium, type Browser, type Page } from 'playwright-core';
import { resolveCdpEndpoint } from '../config.js';
import { TvError } from '../result.js';

export interface Connection {
  readonly browser: Browser;
  readonly page: Page;
}

export async function connect(endpoint: string = resolveCdpEndpoint()): Promise<Connection> {
  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(endpoint);
  } catch {
    throw new TvError(
      'NOT_CONNECTED',
      `Cannot reach Chrome at ${endpoint}. Start it with scripts/launch-chrome.ps1 and log in to TradingView.`,
      { endpoint },
    );
  }
  const page = browser
    .contexts()
    .flatMap((context) => context.pages())
    .find((candidate) => candidate.url().includes('tradingview.com/chart'));
  if (!page) {
    throw new TvError('NO_CHART', 'No TradingView chart tab is open in the dedicated Chrome', { endpoint });
  }
  return { browser, page };
}
```

- [ ] **Step 3: Write `src/driver/pageLayoutOps.ts`**

```ts
import type { Page } from 'playwright-core';
import { SEL, TEXT } from '../selectors.js';
import { TvError } from '../result.js';
import { detectLayout, type LayoutMode, type LayoutOps, type LayoutStep } from './layout.js';

const VISIBLE_TIMEOUT_MS = 10_000;

async function isVisible(page: Page, selector: string): Promise<boolean> {
  return page.locator(selector).first().isVisible().catch(() => false);
}

async function dismissSplitDialog(page: Page): Promise<void> {
  const title = page.getByText(TEXT.splitDialogTitle, { exact: true });
  const appeared = await title.waitFor({ state: 'visible', timeout: 1500 }).then(
    () => true,
    () => false,
  );
  if (appeared) await page.getByRole('button', { name: 'Cancel', exact: true }).click();
}

async function openPineLogs(page: Page): Promise<void> {
  await page.locator(SEL.overlayMoreButton).click();
  // Click the left edge of the row: the row's centre can hit the "?" help icon.
  await page.getByText(TEXT.pineLogsMenu, { exact: true }).first().click({ position: { x: 8, y: 8 } });
  const confirm = page.getByRole('button', { name: TEXT.splitConfirm });
  const help = page.getByText(TEXT.helpCenter, { exact: true });
  const seen = await Promise.race([
    confirm.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'confirm' as const),
    help.waitFor({ state: 'visible', timeout: 8000 }).then(() => 'help' as const),
  ]).catch(() => 'none' as const);
  if (seen === 'help') {
    await page.keyboard.press('Escape');
    throw new TvError(
      'UNEXPECTED_DIALOG',
      'The Help Center opened instead of the Pine logs panel. Close it manually, then retry.',
      { dialog: TEXT.helpCenter },
    );
  }
  if (seen === 'confirm') await confirm.click();
  try {
    await page.locator(SEL.splitRoot).waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
  } catch {
    throw new TvError('LAYOUT_FAILED', 'The split layout did not appear after requesting Pine logs', { seen });
  }
}

async function runStep(page: Page, step: LayoutStep): Promise<void> {
  if (step === 'openEditor') {
    await page.locator(SEL.openEditorButton).click();
  } else if (step === 'toOverlay') {
    await page.locator(SEL.toOverlayButton).click();
  } else {
    await openPineLogs(page);
    return;
  }
  await page.locator(SEL.overlayRoot).first().waitFor({ state: 'visible', timeout: VISIBLE_TIMEOUT_MS });
  if (step === 'toOverlay') await dismissSplitDialog(page);
}

export function createPageLayoutOps(page: Page): LayoutOps {
  return {
    async detect(): Promise<LayoutMode> {
      return detectLayout({
        overlayVisible: await isVisible(page, SEL.overlayRoot),
        splitVisible: await isVisible(page, SEL.splitRoot),
      });
    },
    run: (step) => runStep(page, step),
  };
}
```

- [ ] **Step 4: Write `scripts/launch-chrome.ps1`**

```powershell
# Starts a dedicated Chrome profile with the DevTools protocol on loopback only.
# Log in to TradingView once in this window; use it for TradingView only.
param(
  [string]$ProfileDir = (Join-Path $PSScriptRoot "..\.chrome-profile"),
  [int]$Port = 9222,
  [string]$Url = "https://www.tradingview.com/chart/"
)
$chrome = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "Chrome not found" }
& $chrome `
  --remote-debugging-port=$Port `
  --remote-debugging-address=127.0.0.1 `
  --user-data-dir="$ProfileDir" `
  --no-first-run `
  $Url
```

- [ ] **Step 5: Write fixtures and the live smoke harness**

`test/fixtures/pine.ts`:
```ts
export const SOURCES = {
  valid: `//@version=6
indicator("TV Bridge Smoke", overlay=true)
plot(close)
`,
  broken: `//@version=6
indicator("TV Bridge Smoke", overlay=true)
f(x) =>
    y = math.max(x, open) * 2
    z = (y > 0) ? y : -y
    z
plot(f(close) +)
`,
  runtimeError: `//@version=6
indicator("TV Bridge Smoke")
a = array.new_float(1, 1.0)
if barstate.islast
    log.info("x={0}", array.get(a, 5))
plot(close)
`,
  strategy: `//@version=6
strategy("TV Bridge Smoke", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
fast = ta.sma(close, 10)
slow = ta.sma(close, 30)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("L")
if barstate.islast
    log.info("last bar close={0} fast={1}", close, fast)
plot(fast)
plot(slow)
`,
} as const;
```

`test/live-smoke.ts`:
```ts
// Live smoke test. Needs Chrome from scripts/launch-chrome.ps1, logged in to TradingView.
// Sections that write to the editor replace its contents: open a scratch script first and set
// TV_SMOKE_OVERWRITE_EDITOR=1. Usage: npm run smoke -- <section|all>
import type { Page } from 'playwright-core';
import { connect } from '../src/driver/connection.js';
import { createPageLayoutOps } from '../src/driver/pageLayoutOps.js';
import { ensureLayout } from '../src/driver/layout.js';

type Section = (page: Page) => Promise<void>;

export const state: { owned: string | null } = { owned: null };

export function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`SMOKE FAIL: ${message}`);
  console.log(`ok - ${message}`);
}

export function requireOverwriteFlag(): void {
  if (process.env.TV_SMOKE_OVERWRITE_EDITOR !== '1') {
    throw new Error('Refusing to overwrite the editor. Open a scratch script and set TV_SMOKE_OVERWRITE_EDITOR=1.');
  }
}

const sections: Record<string, Section> = {
  layout: async (page) => {
    const ops = createPageLayoutOps(page);
    await ensureLayout(ops, 'overlay');
    check((await ops.detect()) === 'overlay', 'overlay layout reached');
    await ensureLayout(ops, 'split');
    check((await ops.detect()) === 'split', 'split layout reached (Pine logs open)');
    await ensureLayout(ops, 'overlay');
    check((await ops.detect()) === 'overlay', 'overlay layout restored');
  },
  // SECTIONS-END (add new sections above this line)
};

async function main(): Promise<void> {
  const name = process.argv[2] ?? 'all';
  const { browser, page } = await connect();
  try {
    const names = name === 'all' ? Object.keys(sections) : [name];
    for (const section of names) {
      const run = sections[section];
      if (!run) throw new Error(`Unknown section: ${section}. Known: ${Object.keys(sections).join(', ')}`);
      console.log(`--- ${section}`);
      await run(page);
    }
    console.log('SMOKE PASSED');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 6: Typecheck, launch Chrome, run the layout smoke**

Run: `npm run typecheck`
Expected: exits 0.

Run (user, once): `! powershell -File D:\TradeBots\BrowserAI\scripts\launch-chrome.ps1`, log in to TradingView, open a chart and the Pine Editor.

Run: `npm run smoke -- layout`
Expected output ends with `ok - overlay layout restored` and `SMOKE PASSED`. If it throws `UNEXPECTED_DIALOG` (Help Center), close the Help Center manually and rerun; if it persists, record the observed DOM in `spike/FINDINGS.md` and fix the `openPineLogs` click.

- [ ] **Step 7: Commit**

```bash
git add src/selectors.ts src/driver scripts test
git commit -m "feat: selectors, CDP connection, layout manager, smoke harness" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Editor I/O, legend reads, compile orchestration

**Files:**
- Create: `src/driver/editor.ts`, `src/driver/legend.ts`, `src/driver/compile.ts`
- Modify: `test/live-smoke.ts` (add `compile` section)

**Interfaces:**
- Consumes: `SEL`; `parseConsoleEntries`, `parseProblemCodes`, `analyzeCompile`, `CompileProblem` (console.ts); `parseRuntimeStatus`, `RuntimeError` (runtime.ts); `pickOwnedEntity`, `LegendRow` (ownership.ts); `pollUntil`, `realSleep` (waits.ts); `sourcesEqual`; `TvError`
- Produces (`editor.ts`): `pasteSource(page, source): Promise<void>`, `copySource(page): Promise<string>`, `writeAndVerify(page, source): Promise<void>` (throws `PASTE_MISMATCH`), `readConsole(page): Promise<{entries: ConsoleEntry[]; problems: ProblemCode[]}>`, `triggerCompile(page): Promise<void>`
- Produces (`legend.ts`): `listLegendRows(page): Promise<LegendRow[]>`, `readStatusTitle(page, entityId): Promise<string | null>`
- Produces (`compile.ts`): `CompileReport {action, errors, warnings, runtimeError: RuntimeError, ownedEntityId: string | null, elapsedMs: number}`, `compileAndCollect(page, args: {previousOwned: string | null; scriptTitle: string | null; timeoutMs?: number; settleMs?: number}): Promise<CompileReport>` (throws `TIMEOUT_COMPILE`)

- [ ] **Step 1: Write `src/driver/editor.ts`**

```ts
import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { sourcesEqual } from '../parsers/source.js';
import {
  parseConsoleEntries,
  parseProblemCodes,
  type ConsoleEntry,
  type ProblemCode,
} from '../parsers/console.js';

const SURFACE = `${SEL.overlayRoot} ${SEL.editorSurface}`;

async function focusEditor(page: Page): Promise<void> {
  await page.locator(SURFACE).first().click();
}

export async function pasteSource(page: Page, source: string): Promise<void> {
  const origin = new URL(page.url()).origin;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await focusEditor(page);
  await page.evaluate((text) => navigator.clipboard.writeText(text), source);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+V');
}

export async function copySource(page: Page): Promise<string> {
  const origin = new URL(page.url()).origin;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  await focusEditor(page);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Control+C');
  return page.evaluate(() => navigator.clipboard.readText());
}

export async function writeAndVerify(page: Page, source: string): Promise<void> {
  await pasteSource(page, source);
  const actual = await copySource(page);
  if (!sourcesEqual(source, actual)) {
    throw new TvError('PASTE_MISMATCH', 'Editor content differs from the source that was pasted', {
      expectedLength: source.length,
      actualLength: actual.length,
    });
  }
}

export async function readConsole(
  page: Page,
): Promise<{ entries: ConsoleEntry[]; problems: ProblemCode[] }> {
  const text = await page.locator(SEL.overlayRoot).first().innerText();
  return { entries: parseConsoleEntries(text), problems: parseProblemCodes(text) };
}

export async function triggerCompile(page: Page): Promise<void> {
  await focusEditor(page);
  await page.keyboard.press('Control+Enter');
}
```

- [ ] **Step 2: Write `src/driver/legend.ts`**

```ts
import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import type { LegendRow } from './ownership.js';

export async function listLegendRows(page: Page): Promise<LegendRow[]> {
  return page.evaluate(
    ([itemSelector, titleSelector]: string[]) =>
      Array.from(document.querySelectorAll(itemSelector!))
        .map((element) => ({
          entityId: element.getAttribute('data-entity-id') ?? '',
          title: ((element.querySelector(titleSelector!) as HTMLElement | null)?.innerText ?? '').trim(),
        }))
        .filter((row) => row.entityId !== ''),
    [SEL.legendItem, SEL.legendTitle],
  );
}

export async function readStatusTitle(page: Page, entityId: string): Promise<string | null> {
  return page.evaluate(
    ([itemSelector, statusSelector, id]: string[]) => {
      const row = Array.from(document.querySelectorAll(itemSelector!)).find(
        (element) => element.getAttribute('data-entity-id') === id,
      );
      return row?.querySelector(statusSelector!)?.getAttribute('title') ?? null;
    },
    [SEL.legendItem, SEL.legendStatus, entityId],
  );
}
```

- [ ] **Step 3: Write `src/driver/compile.ts`**

```ts
import type { Page } from 'playwright-core';
import { TvError } from '../result.js';
import { analyzeCompile, type CompileOutcome, type CompileProblem } from '../parsers/console.js';
import { parseRuntimeStatus, type RuntimeError } from '../parsers/runtime.js';
import { readConsole, triggerCompile } from './editor.js';
import { listLegendRows, readStatusTitle } from './legend.js';
import { pickOwnedEntity } from './ownership.js';
import { pollUntil, realSleep } from './waits.js';

export interface CompileReport {
  readonly action: 'added' | 'updated' | null;
  readonly errors: readonly CompileProblem[];
  readonly warnings: readonly CompileProblem[];
  readonly runtimeError: RuntimeError;
  readonly ownedEntityId: string | null;
  readonly elapsedMs: number;
}

export interface CompileArgs {
  readonly previousOwned: string | null;
  readonly scriptTitle: string | null;
  readonly timeoutMs?: number;
  readonly settleMs?: number;
}

async function waitForOutcome(page: Page, baseline: number, timeoutMs: number): Promise<CompileOutcome> {
  const outcome = await pollUntil(
    async () => {
      const { entries, problems } = await readConsole(page);
      // If the console was cleared (fewer entries than the baseline), treat all entries as new.
      const fresh = entries.length >= baseline ? entries.slice(baseline) : entries;
      const analysed = analyzeCompile(fresh, problems);
      return analysed.finished ? analysed : null;
    },
    { timeoutMs, intervalMs: 300 },
  );
  if (!outcome) {
    const { entries } = await readConsole(page);
    throw new TvError('TIMEOUT_COMPILE', `Compile did not finish within ${timeoutMs} ms`, {
      lastConsole: entries.slice(-5).map((entry) => entry.message),
    });
  }
  return outcome;
}

export async function compileAndCollect(page: Page, args: CompileArgs): Promise<CompileReport> {
  const startedAt = Date.now();
  const baseline = (await readConsole(page)).entries.length;
  const rowsBefore = await listLegendRows(page);
  await triggerCompile(page);
  const outcome = await waitForOutcome(page, baseline, args.timeoutMs ?? 15_000);
  if (outcome.errors.length > 0) {
    return {
      action: outcome.action,
      errors: outcome.errors,
      warnings: outcome.warnings,
      runtimeError: { present: false },
      ownedEntityId: args.previousOwned,
      elapsedMs: Date.now() - startedAt,
    };
  }
  await realSleep(args.settleMs ?? 2500);
  const owned = pickOwnedEntity({
    before: rowsBefore,
    after: await listLegendRows(page),
    scriptTitle: args.scriptTitle,
    previousOwned: args.previousOwned,
    action: outcome.action,
  });
  const statusTitle = owned ? await readStatusTitle(page, owned) : null;
  return {
    action: outcome.action,
    errors: [],
    warnings: outcome.warnings,
    runtimeError: parseRuntimeStatus(statusTitle),
    ownedEntityId: owned,
    elapsedMs: Date.now() - startedAt,
  };
}
```

- [ ] **Step 4: Add the `compile` smoke section**

In `test/live-smoke.ts` add these imports after the existing imports:
```ts
import { SOURCES } from './fixtures/pine.js';
import { writeAndVerify } from '../src/driver/editor.js';
import { compileAndCollect } from '../src/driver/compile.js';
import { extractScriptTitle } from '../src/parsers/source.js';
```
Insert this entry directly above the `// SECTIONS-END` line:
```ts
  compile: async (page) => {
    requireOverwriteFlag();
    await ensureLayout(createPageLayoutOps(page), 'overlay');
    const title = extractScriptTitle(SOURCES.broken);

    await writeAndVerify(page, SOURCES.broken);
    const bad = await compileAndCollect(page, { previousOwned: state.owned, scriptTitle: title });
    check(bad.errors.length >= 1, 'broken source reports a compile error');
    check(bad.errors[0]!.line === 7, `error is on line 7 (got ${bad.errors[0]!.line})`);

    await writeAndVerify(page, SOURCES.valid);
    const good = await compileAndCollect(page, { previousOwned: state.owned, scriptTitle: title });
    check(good.errors.length === 0 && good.action !== null, `valid source compiles (${good.action})`);
    check(!good.runtimeError.present, 'valid source has no runtime error');
    state.owned = good.ownedEntityId;
    check(state.owned !== null, 'bridge owns the legend row it added');

    await writeAndVerify(page, SOURCES.runtimeError);
    const runtime = await compileAndCollect(page, { previousOwned: state.owned, scriptTitle: title });
    check(runtime.errors.length === 0, 'runtime-error source compiles');
    check(
      runtime.runtimeError.present && /^RE\d+$/.test(runtime.runtimeError.code ?? ''),
      `runtime error detected (${runtime.runtimeError.code})`,
    );
    state.owned = runtime.ownedEntityId;
  },
```

- [ ] **Step 5: Typecheck and run the compile smoke**

Run: `npm run typecheck`
Expected: exits 0.

Run (with a scratch script open in the editor): `set TV_SMOKE_OVERWRITE_EDITOR=1` then `npm run smoke -- compile`
Expected: every line starts with `ok -` including `error is on line 7`, `runtime error detected (RE...)`, and ends with `SMOKE PASSED`.

- [ ] **Step 6: Commit**

```bash
git add src/driver test
git commit -m "feat: editor paste/copy, legend reads, compile orchestration" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Script removal

**Files:**
- Modify: `src/driver/legend.ts` (append `removeLegendRow`)
- Modify: `test/live-smoke.ts` (add `remove` section)

**Interfaces:**
- Consumes: `SEL`, `TvError`, `pollUntil`
- Produces: `removeLegendRow(page: Page, entityId: string): Promise<{removed: boolean; reason?: string}>` (throws `REMOVE_FAILED`); restores the legend's collapsed state if it expanded it

- [ ] **Step 1: Append to `src/driver/legend.ts`**

Add imports at the top: `import { TvError } from '../result.js';` and `import { pollUntil } from './waits.js';`. Then append:
```ts
const ENTITY_ID = /^[A-Za-z0-9_-]+$/;

export async function removeLegendRow(
  page: Page,
  entityId: string,
): Promise<{ removed: boolean; reason?: string }> {
  if (!ENTITY_ID.test(entityId)) {
    throw new TvError('INTERNAL', `Unexpected legend entity id: ${entityId}`);
  }
  const row = page.locator(`${SEL.legendItem}[data-entity-id="${entityId}"]`);
  if ((await row.count()) === 0) {
    return { removed: false, reason: 'Legend row not found (already removed or the chart was reloaded)' };
  }
  const legend = row.locator(`xpath=ancestor::*[@data-qa-id="legend"][1]`);
  const toggler = legend.locator(SEL.legendToggler);
  const wasCollapsed = await legend
    .locator(SEL.legendSources)
    .evaluate((element) => /closed/.test(element.className));
  // A collapsed legend is covered by a canvas that blocks pointer events: expand it first.
  if (wasCollapsed) await toggler.click();
  await row.locator(SEL.legendDelete).click({ timeout: 5000 });
  const gone = await pollUntil(async () => (await row.count()) === 0, { timeoutMs: 5000, intervalMs: 250 });
  if (!gone) {
    throw new TvError('REMOVE_FAILED', 'The legend row was still present after clicking Remove', { entityId });
  }
  if (wasCollapsed && (await toggler.isVisible().catch(() => false))) await toggler.click();
  return { removed: true };
}
```

- [ ] **Step 2: Add the `remove` smoke section**

Add the import `import { listLegendRows, removeLegendRow } from '../src/driver/legend.js';` to `test/live-smoke.ts`, then insert above `// SECTIONS-END`:
```ts
  remove: async (page) => {
    if (!state.owned) throw new Error("Run the 'compile' section first (it records the owned legend row).");
    const result = await removeLegendRow(page, state.owned);
    check(result.removed, 'owned script removed from the chart');
    const rows = await listLegendRows(page);
    check(!rows.some((row) => row.entityId === state.owned), 'legend no longer lists the removed row');
    const again = await removeLegendRow(page, state.owned);
    check(!again.removed, 'removing again reports row not found instead of failing');
    state.owned = null;
  },
```

- [ ] **Step 3: Typecheck and run compile + remove**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm run smoke -- all`
Expected: sections `layout`, `compile`, `remove` all print `ok -` lines and `SMOKE PASSED`; the chart no longer shows the `TV Bridge Smoke` script; other indicators are untouched (count in the collapsed legend label is unchanged).

- [ ] **Step 4: Commit**

```bash
git add src/driver test
git commit -m "feat: scoped removal of the bridge-owned legend row" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Strategy Tester reader

**Files:**
- Create: `src/driver/strategyReader.ts`
- Modify: `test/live-smoke.ts` (add `strategy` section)

**Interfaces:**
- Consumes: `SEL`, `TEXT`, `TvError`, `pollUntil`, `parseKeyStats`, `parseTradeRows`, `KeyStats`, `Trade`
- Produces: `readKeyStats(page: Page, timeoutMs?: number): Promise<KeyStats>` (throws `SELECTOR_MISSING` if the Strategy Tester tabs are absent, `TIMEOUT_REPORT` when the report never renders); `readTrades(page: Page, limit: number): Promise<{trades: Trade[]; unparsed: number}>`

- [ ] **Step 1: Write `src/driver/strategyReader.ts`**

```ts
import type { Page } from 'playwright-core';
import { SEL, TEXT } from '../selectors.js';
import { TvError } from '../result.js';
import { parseKeyStats, parseTradeRows, type KeyStats, type Trade } from '../parsers/strategy.js';
import { pollUntil } from './waits.js';

const DEFAULT_REPORT_TIMEOUT_MS = 30_000;

async function smallestTextContaining(page: Page, needles: readonly string[]): Promise<string | null> {
  return page.evaluate((wanted: string[]) => {
    let best: string | null = null;
    for (const element of Array.from(document.querySelectorAll('div'))) {
      const text = (element as HTMLElement).innerText;
      if (!text || !wanted.every((needle) => text.includes(needle))) continue;
      if (best === null || text.length < best.length) best = text;
    }
    return best;
  }, [...needles]);
}

async function openTab(page: Page, selector: string, name: string): Promise<void> {
  const tab = page.locator(selector).first();
  if (!(await tab.isVisible().catch(() => false))) {
    throw new TvError(
      'SELECTOR_MISSING',
      `The Strategy Tester "${name}" tab is not visible. Add a strategy to the chart and open the Strategy Tester.`,
      { selector },
    );
  }
  await tab.click();
}

export async function readKeyStats(
  page: Page,
  timeoutMs: number = DEFAULT_REPORT_TIMEOUT_MS,
): Promise<KeyStats> {
  await openTab(page, SEL.reportTab, 'Strategy report');
  const text = await pollUntil(() => smallestTextContaining(page, TEXT.reportLabels), {
    timeoutMs,
    intervalMs: 500,
  });
  if (!text) {
    throw new TvError('TIMEOUT_REPORT', `The Strategy Tester report did not render within ${timeoutMs} ms`, {
      timeoutMs,
    });
  }
  return parseKeyStats(text);
}

export async function readTrades(
  page: Page,
  limit: number,
): Promise<{ trades: Trade[]; unparsed: number }> {
  await openTab(page, SEL.tradesTab, 'List of Trades');
  const rows = await pollUntil(
    async () => {
      const texts = await page.locator('[role="row"], tr').allInnerTexts();
      return texts.some((text) => /^\s*\d+(Long|Short)/.test(text)) ? texts : null;
    },
    { timeoutMs: 5000, intervalMs: 500 },
  );
  const parsed = parseTradeRows(rows ?? []);
  await page.locator(SEL.reportTab).first().click().catch(() => undefined);
  return { trades: parsed.trades.slice(0, limit), unparsed: parsed.unparsed };
}
```

- [ ] **Step 2: Add the `strategy` smoke section**

Add the import `import { readKeyStats, readTrades } from '../src/driver/strategyReader.js';` and insert above `// SECTIONS-END`:
```ts
  strategy: async (page) => {
    requireOverwriteFlag();
    await ensureLayout(createPageLayoutOps(page), 'overlay');
    await writeAndVerify(page, SOURCES.strategy);
    const report = await compileAndCollect(page, {
      previousOwned: state.owned,
      scriptTitle: extractScriptTitle(SOURCES.strategy),
    });
    check(report.errors.length === 0, 'strategy compiles');
    state.owned = report.ownedEntityId;
    const stats = await readKeyStats(page, 45_000);
    console.log(JSON.stringify(stats));
    check(stats.totalPnl !== null, 'Total PnL parsed');
    check(stats.profitFactor !== null, 'Profit factor parsed');
    check(stats.profitableTrades !== null && stats.profitableTrades.total > 0, 'Profitable trades parsed');
    const { trades, unparsed } = await readTrades(page, 5);
    check(trades.length > 0, `trade list parsed (${trades.length} rows)`);
    check(unparsed === 0, `no unparsed trade rows (got ${unparsed})`);
  },
```

- [ ] **Step 3: Typecheck and run**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm run smoke -- strategy`
Expected: prints a JSON line with real stats and `ok -` for each check. If `Total PnL parsed` fails, the live `innerText` layout differs from the reconstructed fixture: copy the actual text into `test/parsers/strategy.test.ts` as a new fixture, make the test fail, then fix `parseKeyStats`. If `unparsed` is non-zero, do the same with the failing trade row text.

- [ ] **Step 4: Commit**

```bash
git add src/driver test
git commit -m "feat: Strategy Tester key stats and trade list reader" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Pine logs reader

**Files:**
- Create: `src/driver/logsReader.ts`
- Modify: `test/live-smoke.ts` (add `logs` section)

**Interfaces:**
- Consumes: `LayoutOps`, `ensureLayout`, `pollUntil`, `parsePineLogs`, `PineLogLine`
- Produces: `readPineLogs(page: Page, ops: LayoutOps): Promise<{lines: PineLogLine[]; layoutRestored: boolean}>` (switches to split, reads, returns to overlay)

- [ ] **Step 1: Write `src/driver/logsReader.ts`**

```ts
import type { Page } from 'playwright-core';
import { parsePineLogs, type PineLogLine } from '../parsers/logs.js';
import { ensureLayout, type LayoutOps } from './layout.js';
import { pollUntil } from './waits.js';

async function collectLogLines(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pattern = /^\[\d{4}-\d{2}-\d{2}T[^\]]+\]:/;
    const candidates = Array.from(document.querySelectorAll('div')).filter((element) =>
      pattern.test(((element as HTMLElement).innerText ?? '').trim()),
    );
    const innermost = candidates.filter(
      (candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other)),
    );
    return innermost.map((element) => (element as HTMLElement).innerText.trim());
  });
}

async function logsOrEmptyState(page: Page): Promise<string[] | null> {
  const lines = await collectLogLines(page);
  if (lines.length > 0) return lines;
  const empty = await page.getByText('No data', { exact: true }).first().isVisible().catch(() => false);
  return empty ? [] : null;
}

export async function readPineLogs(
  page: Page,
  ops: LayoutOps,
): Promise<{ lines: PineLogLine[]; layoutRestored: boolean }> {
  await ensureLayout(ops, 'split');
  let layoutRestored = false;
  let rawLines: string[] = [];
  try {
    rawLines = (await pollUntil(async () => logsOrEmptyState(page), { timeoutMs: 8000, intervalMs: 500 })) ?? [];
  } finally {
    // Restoration failure is reported, not thrown, so the data already read is not lost.
    layoutRestored = await ensureLayout(ops, 'overlay').then(
      () => true,
      () => false,
    );
  }
  return { lines: parsePineLogs(rawLines), layoutRestored };
}
```

- [ ] **Step 2: Add the `logs` smoke section**

Add the import `import { readPineLogs } from '../src/driver/logsReader.js';` and insert above `// SECTIONS-END`:
```ts
  logs: async (page) => {
    const ops = createPageLayoutOps(page);
    const result = await readPineLogs(page, ops);
    console.log(JSON.stringify(result.lines.slice(-2)));
    check(
      result.lines.some((line) => line.text.includes('last bar close=')),
      "log.info output from the 'strategy' section was read",
    );
    check(result.layoutRestored, 'overlay layout restored after reading logs');
  },
```

- [ ] **Step 3: Typecheck and run**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm run smoke -- strategy` then `npm run smoke -- logs`
Expected: `logs` prints the last log lines (including `last bar close=`) and `ok - overlay layout restored after reading logs`. The strategy from the previous run stays on the chart (the next task's `cleanup` removes it).

- [ ] **Step 4: Commit**

```bash
git add src/driver test
git commit -m "feat: Pine logs reader with layout restore" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Chart helpers (status, navigation, screenshot) and selector self-test

**Files:**
- Create: `src/driver/chart.ts`, `src/driver/selftest.ts`
- Test: `test/driver/selftest.test.ts`
- Modify: `test/live-smoke.ts` (add `chart` and `cleanup` sections)

**Interfaces:**
- Consumes: `SEL`, `parseChartLabel`, `ChartLabel`, `TvError`
- Produces (`chart.ts`): `readChartLabel(page): Promise<ChartLabel | null>`, `isLoggedIn(page): Promise<boolean>`, `takeScreenshot(page): Promise<Buffer>`, `navigateToChart(page, args: {symbol?: string; interval?: string}): Promise<string>` (throws `INVALID_ARGUMENT` if neither given)
- Produces (`selftest.ts`): `SelectorCheck {name, selector, found, required}`, `summarizeChecks(checks: readonly SelectorCheck[]): string[]` (names of required checks not found), `runSelftest(page): Promise<SelectorCheck[]>`

- [ ] **Step 1: Write the failing test for `summarizeChecks`**

`test/driver/selftest.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { summarizeChecks, type SelectorCheck } from '../../src/driver/selftest.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/driver/selftest.test.ts`
Expected: FAIL, cannot find `../../src/driver/selftest.js`.

- [ ] **Step 3: Write `src/driver/selftest.ts` and `src/driver/chart.ts`**

`src/driver/selftest.ts`:
```ts
import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';

export interface SelectorCheck {
  readonly name: string;
  readonly selector: string;
  readonly found: boolean;
  readonly required: boolean;
}

const CHECKS: ReadonlyArray<{ name: string; selector: string; required: boolean }> = [
  { name: 'overlayRoot', selector: SEL.overlayRoot, required: true },
  { name: 'editorSurface', selector: `${SEL.overlayRoot} ${SEL.editorSurface}`, required: true },
  { name: 'overlayMoreButton', selector: SEL.overlayMoreButton, required: true },
  { name: 'chartCanvas', selector: SEL.chartCanvas, required: true },
  { name: 'legendToggler', selector: SEL.legendToggler, required: false },
  { name: 'reportTab', selector: SEL.reportTab, required: false },
  { name: 'tradesTab', selector: SEL.tradesTab, required: false },
];

export function summarizeChecks(checks: readonly SelectorCheck[]): string[] {
  return checks.filter((check) => check.required && !check.found).map((check) => check.name);
}

export async function runSelftest(page: Page): Promise<SelectorCheck[]> {
  return Promise.all(
    CHECKS.map(async (check) => ({
      ...check,
      found: (await page.locator(check.selector).count()) > 0,
    })),
  );
}
```

`src/driver/chart.ts`:
```ts
import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { parseChartLabel, type ChartLabel } from '../parsers/chart.js';

export async function readChartLabel(page: Page): Promise<ChartLabel | null> {
  const label = await page
    .locator(SEL.chartCanvas)
    .first()
    .getAttribute('aria-label', { timeout: 3000 })
    .catch(() => null);
  return label ? parseChartLabel(label) : null;
}

// Heuristic: the sign-in button is absent when logged in. Confirmed only for the logged-in state.
export async function isLoggedIn(page: Page): Promise<boolean> {
  return (await page.locator(SEL.signInButton).count()) === 0;
}

export async function takeScreenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ type: 'png' });
}

export async function navigateToChart(
  page: Page,
  args: { symbol?: string; interval?: string },
): Promise<string> {
  if (!args.symbol && !args.interval) {
    throw new TvError('INVALID_ARGUMENT', 'Provide a symbol, an interval, or both');
  }
  const url = new URL(page.url());
  if (args.symbol) url.searchParams.set('symbol', args.symbol);
  if (args.interval) url.searchParams.set('interval', args.interval);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.locator(SEL.chartCanvas).first().waitFor({ timeout: 30_000 });
  return page.url();
}
```

- [ ] **Step 4: Add the `chart` and `cleanup` smoke sections**

Add the imports `import { readChartLabel, isLoggedIn, takeScreenshot } from '../src/driver/chart.js';` and insert above `// SECTIONS-END`:
```ts
  chart: async (page) => {
    await ensureLayout(createPageLayoutOps(page), 'overlay');
    const label = await readChartLabel(page);
    check(label !== null, `chart label read (${label?.symbol} ${label?.interval})`);
    check(await isLoggedIn(page), 'logged in to TradingView');
    const png = await takeScreenshot(page);
    check(png.length > 5000, `screenshot captured (${png.length} bytes)`);
  },
  cleanup: async (page) => {
    if (!state.owned) {
      console.log('nothing to clean up');
      return;
    }
    const result = await removeLegendRow(page, state.owned);
    check(result.removed, 'cleanup removed the bridge-owned script');
    state.owned = null;
  },
```

- [ ] **Step 5: Run unit tests, typecheck, and smoke**

Run: `npx vitest run && npm run typecheck`
Expected: all unit tests PASS; typecheck exits 0.

Run: `npm run smoke -- chart` then `npm run smoke -- cleanup`
Expected: `chart` prints the symbol label and a screenshot size; `cleanup` prints `nothing to clean up` when run alone (the owned row from a previous process is not remembered, remove any leftover `TV Bridge Smoke` script from the legend manually).

- [ ] **Step 6: Commit**

```bash
git add src/driver test
git commit -m "feat: chart helpers, screenshot, navigation and selector self-test" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: TvDriver (assembly, report-stall recovery) and driver smoke

**Files:**
- Create: `src/driver/types.ts`, `src/driver/driver.ts`, `src/driver/provider.ts`
- Modify: `test/live-smoke.ts` (add `driver` section)

**Interfaces:**
- Consumes: everything from Tasks 7 to 13
- Produces (`types.ts`): `StatusInfo {loggedIn, chartOpen, symbol, interval, layout, url}`, `CompilePayload {compiled, action, errors, warnings, runtimeError, elapsedMs}`, `StrategyPayload {keyStats, trades?, unparsedTradeRows?}`, `SelftestPayload {layout, checks, failures}`, `interface DriverApi` (below)
- Produces (`driver.ts`): `class TvDriver implements DriverApi` with `constructor(page: Page)`
- Produces (`provider.ts`): `createDriverProvider(endpoint?: string): () => Promise<TvDriver>` (lazy connect; reconnects when the page closed)

- [ ] **Step 1: Write `src/driver/types.ts`**

```ts
import type { CompileProblem } from '../parsers/console.js';
import type { RuntimeError } from '../parsers/runtime.js';
import type { KeyStats, Trade } from '../parsers/strategy.js';
import type { PineLogLine } from '../parsers/logs.js';
import type { LayoutMode } from './layout.js';
import type { SelectorCheck } from './selftest.js';

export interface StatusInfo {
  readonly loggedIn: boolean;
  readonly chartOpen: boolean;
  readonly symbol: string | null;
  readonly interval: string | null;
  readonly layout: LayoutMode;
  readonly url: string;
}

export interface CompilePayload {
  readonly compiled: boolean;
  readonly action: 'added' | 'updated' | null;
  readonly errors: readonly CompileProblem[];
  readonly warnings: readonly CompileProblem[];
  readonly runtimeError: RuntimeError;
  readonly elapsedMs: number;
}

export interface StrategyPayload {
  readonly keyStats: KeyStats;
  readonly trades?: readonly Trade[];
  readonly unparsedTradeRows?: number;
}

export interface SelftestPayload {
  readonly layout: LayoutMode;
  readonly checks: readonly SelectorCheck[];
  readonly failures: readonly string[];
}

export interface DriverApi {
  status(): Promise<StatusInfo>;
  openChart(args: { symbol?: string; interval?: string }): Promise<{ url: string }>;
  setScript(source: string): Promise<{ length: number }>;
  getScript(): Promise<{ source: string }>;
  compile(): Promise<CompilePayload>;
  screenshot(): Promise<{ png: Buffer }>;
  readPineLogs(): Promise<{ lines: readonly PineLogLine[]; layoutRestored: boolean }>;
  readStrategyStats(args: { includeTrades: boolean; tradeLimit: number }): Promise<StrategyPayload>;
  removeScript(): Promise<{ removed: boolean; reason?: string }>;
  selftest(): Promise<SelftestPayload>;
}
```

- [ ] **Step 2: Write `src/driver/driver.ts`**

```ts
import type { Page } from 'playwright-core';
import { SEL } from '../selectors.js';
import { TvError } from '../result.js';
import { extractScriptTitle } from '../parsers/source.js';
import { compileAndCollect } from './compile.js';
import { copySource, writeAndVerify } from './editor.js';
import { ensureLayout, type LayoutOps } from './layout.js';
import { removeLegendRow } from './legend.js';
import { createPageLayoutOps } from './pageLayoutOps.js';
import { readPineLogs } from './logsReader.js';
import { readKeyStats, readTrades } from './strategyReader.js';
import { isLoggedIn, navigateToChart, readChartLabel, takeScreenshot } from './chart.js';
import { runSelftest, summarizeChecks } from './selftest.js';
import type {
  CompilePayload,
  DriverApi,
  SelftestPayload,
  StatusInfo,
  StrategyPayload,
} from './types.js';

export class TvDriver implements DriverApi {
  private ownedEntityId: string | null = null;
  private lastSource: string | null = null;
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
    return { url };
  }

  async setScript(source: string): Promise<{ length: number }> {
    await this.overlay();
    await writeAndVerify(this.page, source);
    this.lastSource = source;
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
    return {
      compiled: report.errors.length === 0 && report.action !== null,
      action: report.action,
      errors: report.errors,
      warnings: report.warnings,
      runtimeError: report.runtimeError,
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
      await this.recoverFromStall();
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
  private async recoverFromStall(): Promise<void> {
    this.page.once('dialog', (dialog) => void dialog.accept());
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.page.locator(SEL.chartCanvas).first().waitFor({ timeout: 30_000 });
    this.ownedEntityId = null;
    await this.overlay();
    await writeAndVerify(this.page, this.lastSource!);
    await this.compile();
  }

  async removeScript(): Promise<{ removed: boolean; reason?: string }> {
    if (!this.ownedEntityId) {
      throw new TvError('NOT_OWNED', 'No script has been added by this bridge in this session');
    }
    await this.overlay();
    const result = await removeLegendRow(this.page, this.ownedEntityId);
    this.ownedEntityId = null;
    return result;
  }

  async selftest(): Promise<SelftestPayload> {
    const layout = await this.overlay();
    const checks = await runSelftest(this.page);
    return { layout, checks, failures: summarizeChecks(checks) };
  }
}
```

- [ ] **Step 3: Write `src/driver/provider.ts`**

```ts
import { resolveCdpEndpoint } from '../config.js';
import { connect } from './connection.js';
import { TvDriver } from './driver.js';

export function createDriverProvider(endpoint?: string): () => Promise<TvDriver> {
  let current: TvDriver | null = null;
  return async () => {
    if (current && !current.page.isClosed()) return current;
    const { page } = await connect(endpoint ?? resolveCdpEndpoint());
    current = new TvDriver(page);
    return current;
  };
}
```

- [ ] **Step 4: Add the `driver` smoke section**

Add the import `import { TvDriver } from '../src/driver/driver.js';` and insert above `// SECTIONS-END`:
```ts
  driver: async (page) => {
    requireOverwriteFlag();
    const driver = new TvDriver(page);
    const status = await driver.status();
    check(status.chartOpen && status.loggedIn, `status ok (${status.symbol}, ${status.interval}, ${status.layout})`);

    await driver.setScript(SOURCES.valid);
    check((await driver.getScript()).source.includes('TV Bridge Smoke'), 'set/get script round trip');
    const compiled = await driver.compile();
    check(compiled.compiled && !compiled.runtimeError.present, `compile ok (${compiled.action})`);

    await driver.setScript(SOURCES.runtimeError);
    const runtime = await driver.compile();
    check(runtime.runtimeError.present, `runtime error surfaced (${runtime.runtimeError.code})`);

    await driver.setScript(SOURCES.strategy);
    await driver.compile();
    const stats = await driver.readStrategyStats({ includeTrades: true, tradeLimit: 3 });
    check(stats.keyStats.totalPnl !== null && (stats.trades?.length ?? 0) > 0, 'strategy stats and trades read');
    const logs = await driver.readPineLogs();
    check(logs.lines.some((line) => line.text.includes('last bar close=')) && logs.layoutRestored, 'pine logs read');

    const selftest = await driver.selftest();
    check(selftest.failures.length === 0, `selftest has no required failures (${selftest.failures.join(',') || 'none'})`);
    const removed = await driver.removeScript();
    check(removed.removed, 'script removed');
    check((await driver.status()).layout === 'overlay', 'layout is overlay at the end');
  },
```

- [ ] **Step 5: Typecheck and run the driver smoke**

Run: `npm run typecheck`
Expected: exits 0.

Run: `npm run smoke -- driver`
Expected: every check prints `ok -` and the run ends with `SMOKE PASSED`; the chart is left without the `TV Bridge Smoke` script.

- [ ] **Step 6: Commit**

```bash
git add src/driver test
git commit -m "feat: TvDriver assembling the page operations with stall recovery" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: MCP wiring, server entry, README

**Files:**
- Create: `src/mcp.ts`, `src/server.ts`, `README.md`
- Test: `test/mcp.test.ts`

**Interfaces:**
- Consumes: `DriverApi` (types.ts), `toResult`, `toFailure`, `TvError`
- Produces: `registerTools(server: McpServer, getDriver: () => Promise<DriverApi>): void` registering `tv_status`, `tv_open_chart`, `tv_set_script`, `tv_get_script`, `tv_compile`, `tv_screenshot`, `tv_read_pine_logs`, `tv_read_strategy_stats`, `tv_remove_script`, `tv_selftest`

- [ ] **Step 1: Write the failing test (in-memory MCP client with a fake driver)**

`test/mcp.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/mcp.js';
import { TvError } from '../src/result.js';
import type { DriverApi } from '../src/driver/types.js';

function fakeDriver(overrides: Partial<DriverApi> = {}): DriverApi {
  const notUsed = async () => {
    throw new Error('not used in this test');
  };
  return {
    status: async () => ({
      loggedIn: true,
      chartOpen: true,
      symbol: 'FX_IDC:EURUSD',
      interval: '1 hour',
      layout: 'overlay',
      url: 'https://www.tradingview.com/chart/',
    }),
    openChart: notUsed,
    setScript: async (source) => ({ length: source.length }),
    getScript: notUsed,
    compile: notUsed,
    screenshot: async () => ({ png: Buffer.from('png-bytes') }),
    readPineLogs: notUsed,
    readStrategyStats: notUsed,
    removeScript: notUsed,
    selftest: notUsed,
    ...overrides,
  } as DriverApi;
}

async function connectClient(driver: DriverApi): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerTools(server, async () => driver);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const textOf = (result: { content: unknown }): string =>
  (result.content as Array<{ type: string; text?: string }>)[0]!.text!;

describe('MCP tools', () => {
  it('lists every tool', async () => {
    const client = await connectClient(fakeDriver());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'tv_compile',
        'tv_get_script',
        'tv_open_chart',
        'tv_read_pine_logs',
        'tv_read_strategy_stats',
        'tv_remove_script',
        'tv_screenshot',
        'tv_selftest',
        'tv_set_script',
        'tv_status',
      ].sort(),
    );
  });

  it('wraps successful results with ok:true', async () => {
    const client = await connectClient(fakeDriver());
    const result = await client.callTool({ name: 'tv_status', arguments: {} });
    expect(JSON.parse(textOf(result))).toMatchObject({ ok: true, symbol: 'FX_IDC:EURUSD', layout: 'overlay' });
    expect(result.isError).toBe(false);
  });

  it('passes tool arguments to the driver', async () => {
    const client = await connectClient(fakeDriver());
    const result = await client.callTool({ name: 'tv_set_script', arguments: { source: 'abc' } });
    expect(JSON.parse(textOf(result))).toEqual({ ok: true, length: 3 });
  });

  it('converts a TvError into a failure result', async () => {
    const client = await connectClient(
      fakeDriver({
        compile: async () => {
          throw new TvError('TIMEOUT_COMPILE', 'slow', { lastConsole: ['Compiling...'] });
        },
      }),
    );
    const result = await client.callTool({ name: 'tv_compile', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result))).toEqual({
      ok: false,
      error: { code: 'TIMEOUT_COMPILE', message: 'slow', details: { lastConsole: ['Compiling...'] } },
    });
  });

  it('rejects tv_open_chart without symbol or interval as INVALID_ARGUMENT', async () => {
    const client = await connectClient(fakeDriver());
    const result = await client.callTool({ name: 'tv_open_chart', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.parse(textOf(result)).error.code).toBe('INVALID_ARGUMENT');
  });

  it('returns the screenshot as a PNG image', async () => {
    const client = await connectClient(fakeDriver());
    const result = await client.callTool({ name: 'tv_screenshot', arguments: {} });
    const content = result.content as Array<{ type: string; data?: string; mimeType?: string }>;
    expect(content[0]).toEqual({
      type: 'image',
      data: Buffer.from('png-bytes').toString('base64'),
      mimeType: 'image/png',
    });
  });

  it('reports driver connection failures from the provider as a failure result', async () => {
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    registerTools(server, async () => {
      throw new TvError('NOT_CONNECTED', 'Chrome is not running');
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: 'tv_status', arguments: {} });
    expect(JSON.parse(textOf(result)).error.code).toBe('NOT_CONNECTED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp.test.ts`
Expected: FAIL, cannot find `../src/mcp.js`.

- [ ] **Step 3: Write `src/mcp.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TvError, toFailure, toResult, type ToolResult } from './result.js';
import type { DriverApi } from './driver/types.js';

export type GetDriver = () => Promise<DriverApi>;

function asText(result: ToolResult<object>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: !result.ok };
}

function runTool<T extends object>(getDriver: GetDriver, fn: (driver: DriverApi) => Promise<T>): Promise<CallToolResult> {
  return toResult(async () => fn(await getDriver())).then(asText);
}

const SYMBOL = z.string().min(1).max(64).regex(/^[A-Za-z0-9_.:!-]+$/, 'symbol contains invalid characters');
const INTERVAL = z.string().min(1).max(8).regex(/^[A-Za-z0-9]+$/, 'interval must be alphanumeric, e.g. 60, D, W');

export function registerTools(server: McpServer, getDriver: GetDriver): void {
  server.tool(
    'tv_status',
    'Check the browser connection, login, open chart (symbol, interval) and editor layout (overlay/split/closed).',
    {},
    () => runTool(getDriver, (d) => d.status()),
  );

  server.tool(
    'tv_open_chart',
    'Navigate the chart to a symbol and/or interval (TradingView URL form, e.g. interval "60", "D"). Reloads the page, which drops unsaved chart contents.',
    { symbol: SYMBOL.optional(), interval: INTERVAL.optional() },
    (args) =>
      runTool(getDriver, async (d) => {
        if (!args.symbol && !args.interval) {
          throw new TvError('INVALID_ARGUMENT', 'Provide a symbol, an interval, or both');
        }
        return d.openChart(args);
      }),
  );

  server.tool(
    'tv_set_script',
    'REPLACES the Pine Editor contents with the given source (clipboard paste, verified by read-back). Open a scratch script first.',
    { source: z.string().min(1).max(200_000) },
    (args) => runTool(getDriver, (d) => d.setScript(args.source)),
  );

  server.tool('tv_get_script', 'Read the current Pine Editor source.', {}, () =>
    runTool(getDriver, (d) => d.getScript()),
  );

  server.tool(
    'tv_compile',
    'Compile and add/update the script on the chart. Returns compile errors (line/column/code), warnings, and any runtime error detected after the script settles. compiled=false means errors.',
    {},
    () => runTool(getDriver, (d) => d.compile()),
  );

  server.tool('tv_screenshot', 'Screenshot of the TradingView viewport as PNG.', {}, async (): Promise<CallToolResult> => {
    try {
      const { png } = await (await getDriver()).screenshot();
      return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
    } catch (error) {
      return asText(toFailure(error));
    }
  });

  server.tool(
    'tv_read_pine_logs',
    'Read log.info/log.warning/log.error output (per bar, timestamped). Briefly switches the editor to split view and back. Format floats explicitly in the script, e.g. str.tostring(x, "#.#####"), since {0} rounds.',
    {},
    () => runTool(getDriver, (d) => d.readPineLogs()),
  );

  server.tool(
    'tv_read_strategy_stats',
    'Read Strategy Tester key stats (Total PnL, Max drawdown, Profitable trades, Profit factor) and optionally the most recent trades. Re-check tuned inputs on a different symbol or date range before trusting them.',
    {
      includeTrades: z.boolean().default(false),
      tradeLimit: z.number().int().min(1).max(500).default(50),
    },
    (args) => runTool(getDriver, (d) => d.readStrategyStats(args)),
  );

  server.tool(
    'tv_remove_script',
    'Remove the script this bridge added in this session. Never removes other indicators.',
    {},
    () => runTool(getDriver, (d) => d.removeScript()),
  );

  server.tool(
    'tv_selftest',
    'Check that the selectors this bridge depends on still resolve in the current TradingView UI.',
    {},
    () => runTool(getDriver, (d) => d.selftest()),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/mcp.test.ts`
Expected: 7 tests PASS. (If the SDK reports `tool` as deprecated, it still works in 1.x; do not migrate in this task.)

- [ ] **Step 5: Write `src/server.ts` and `README.md`**

`src/server.ts`:
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './mcp.js';
import { createDriverProvider } from './driver/provider.js';

const server = new McpServer({ name: 'tradingview-bridge', version: '0.1.0' });
registerTools(server, createDriverProvider());
await server.connect(new StdioServerTransport());
// stdout carries MCP JSON-RPC; log to stderr only.
console.error('tradingview-bridge MCP server ready (stdio)');
```

`README.md`:
````markdown
# TradingView Bridge

MCP server that lets Claude write a Pine Script into TradingView, compile it, and verify the result
(compile errors, runtime errors, Strategy Tester stats and trades, Pine logs, screenshots).

## Setup

1. `npm install`
2. Start the dedicated Chrome (once per session) and log in to TradingView in it:
   `powershell -File scripts\launch-chrome.ps1`
   Use this window for TradingView only: the debugging port gives full control of the profile.
3. Open a **scratch** script in the Pine Editor. `tv_set_script` replaces the editor contents.
4. Register the server with Claude Code:
   `claude mcp add tradingview -- npx tsx D:/TradeBots/BrowserAI/src/server.ts`

## Tools

`tv_status`, `tv_open_chart`, `tv_set_script`, `tv_get_script`, `tv_compile`, `tv_screenshot`,
`tv_read_pine_logs`, `tv_read_strategy_stats`, `tv_remove_script`, `tv_selftest`.

Not implemented yet: `tv_set_inputs`, `tv_read_data_window` (edit `input.*` defaults in the source
and use `log.info` + `tv_read_pine_logs` instead).

## Safety

- The CDP endpoint must be loopback (`TV_CDP_ENDPOINT`, default `http://127.0.0.1:9222`).
- The bridge only touches the script it added; it never uses alerts, orders, watchlists or drawings.
- Review TradingView's terms on automated access before relying on this.

## Development

`npm test` (unit), `npm run test:coverage`, `npm run typecheck`.
Live smoke (needs the logged-in Chrome and a scratch editor):
`set TV_SMOKE_OVERWRITE_EDITOR=1` then `npm run smoke -- all` or `npm run smoke -- driver`.
Spike evidence and UI findings: `spike/FINDINGS.md`.
````

- [ ] **Step 6: Verify the server starts and answers `tools/list`**

Run: `npm run typecheck`
Expected: exits 0.

Run: `echo {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}} | npx tsx src/server.ts`
Expected: stderr shows `tradingview-bridge MCP server ready (stdio)`; stdout shows one JSON-RPC response containing `"serverInfo":{"name":"tradingview-bridge"`.

- [ ] **Step 7: Commit**

```bash
git add src/mcp.ts src/server.ts README.md test/mcp.test.ts
git commit -m "feat: MCP tool wiring, stdio server, README" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Final verification, review, and registration

**Files:**
- Modify: `spike/FINDINGS.md` (only if the smoke runs revealed new facts)

- [ ] **Step 1: Full unit run with coverage gate**

Run: `npm run test:coverage`
Expected: all tests PASS; coverage table shows 80%+ statements, branches, functions and lines for `src/parsers/**`, `src/result.ts`, `src/config.ts`, `src/driver/{waits,layout,ownership,selftest}.ts`. If a threshold fails, add tests for the uncovered branches (do not lower thresholds).

- [ ] **Step 2: Full live smoke from a clean state**

Remove any leftover `TV Bridge Smoke` script from the chart, open a scratch script in the editor, then:
Run: `set TV_SMOKE_OVERWRITE_EDITOR=1` then `npm run smoke -- all`
Expected: `SMOKE PASSED`. Then `npm run smoke -- driver` also passes. After both, the chart has no smoke script and the editor is in overlay layout.

- [ ] **Step 3: Code and security review**

Dispatch the `typescript-reviewer` agent on `src/` and `test/`, and the `security-reviewer` agent focused on: clipboard access and permission grants, the CDP endpoint loopback guard, argument validation in `src/mcp.ts`, and that no code path can reach alerts, orders, watchlists or non-owned indicators. Fix every CRITICAL and HIGH finding, rerun Step 1 and Step 2.

- [ ] **Step 4: Register with Claude Code and exercise one tool**

Run: `claude mcp add tradingview -- npx tsx D:/TradeBots/BrowserAI/src/server.ts`
In a new Claude Code session, ask Claude to call `tv_status` and `tv_selftest`.
Expected: `tv_status` returns the open chart's symbol and `layout: "overlay"`; `tv_selftest` returns `failures: []`.

- [ ] **Step 5: Record any new findings and commit**

```bash
git add -A
git commit -m "chore: final verification and findings" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**
- Scope/guardrails (spec 2, 6): enforced by the absence of any alert/order code, `NOT_OWNED`, scoped removal (Task 10, 14), loopback guard (Task 2). The "never right-click/blind coordinates" rule holds in all driver code.
- Architecture (3): server, driver, selectors, parsers all present (Tasks 3 to 15).
- Tools (4): 10 of 12 implemented; `tv_set_inputs` and `tv_read_data_window` deferred and flagged (Scope notes, README).
- Verify loop guidance (5): encoded in tool descriptions (Task 15) and README.
- Key behaviors (6): clipboard paste (Task 9), staleness via console baseline (Task 9), runtime error via legend status (Tasks 4, 9), layout manager (Tasks 7, 8), stable hooks (Task 8), readiness/recovery (Tasks 11, 14), parsing details (Tasks 3 to 6), removal safety (Task 10).
- Errors (7): all codes in `ERROR_CODES` (Task 1); `UNEXPECTED_DIALOG` raised for the Help Center (Task 8); `TIMEOUT_COMPILE`/`TIMEOUT_REPORT`/`PASTE_MISMATCH`/`NOT_OWNED`/`SELECTOR_MISSING`/`NO_CHART`/`NOT_CONNECTED`/`LAYOUT_FAILED`/`REMOVE_FAILED` raised where described. `NOT_LOGGED_IN` is only reported as `status.loggedIn=false` (no tool throws it yet).
- Security (8): loopback config, validated arguments (zod in Task 15), isolated profile (README).
- Testing (9): parser/logic unit tests with 80% gate, `tv_selftest`, live smoke.
- Layout (11): matches, with finer-grained driver files.

**Placeholder scan:** no TBD/TODO. The one deliberately provisional item (`Warning at L:C` format) is labelled "assumed, not yet observed" in code and test names.

**Type consistency:** `LegendRow`, `LayoutOps`, `LayoutStep`, `CompileReport`, `RuntimeError`, `KeyStats`, `Trade`, `PineLogLine`, `DriverApi` names and signatures match across tasks; `compileAndCollect` args (`previousOwned`, `scriptTitle`) match their uses in Task 9 smoke and Task 14; `readPineLogs(page, ops)` matches the driver call; `removeLegendRow(page, entityId)` matches Tasks 10, 13 and 14.

**Known risks carried into execution**
- Key stats `innerText` layout was reconstructed from a screenshot; Task 11 Step 3 defines the fixture-first fix path if the live text differs.
- The `Pine logs` menu click depends on the left-edge click avoiding the "?" icon; Task 8 Step 6 defines the fallback.
- `compileAndCollect` waits a fixed 2.5 s settle before reading the runtime status; if a slow chart reports it late, raise `settleMs` or poll the status (follow-up).
