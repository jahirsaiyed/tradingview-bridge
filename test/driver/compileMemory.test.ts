import { describe, it, expect } from 'vitest';
import {
  memoryForSource,
  nextMemory,
  ownedAfterCompileError,
  recoveryCompileAccepted,
  resolveCompiled,
  type CompileMemory,
} from '../../src/driver/compileMemory.js';
import { TvError } from '../../src/result.js';

const boom = { line: 3, column: 1, message: 'boom' };
const fresh = { unchanged: false, errors: [], action: 'added', ownedEntityId: 'e1' } as const;
const failed = { unchanged: false, errors: [boom], action: null, ownedEntityId: null } as const;
const same = { unchanged: true, errors: [], action: null, ownedEntityId: 'e1' } as const;

describe('resolveCompiled: fresh compiles', () => {
  it('is compiled after an error-free applied compile and remembers it', () => {
    const { result, next } = resolveCompiled(null, 'a', fresh);
    expect(result).toEqual({ compiled: true, errors: [] });
    expect(next).toEqual({ source: 'a', compiled: true, errors: [] });
  });

  it('is not compiled with errors and remembers the errors for that source', () => {
    const { result, next } = resolveCompiled(null, 'a', failed);
    expect(result).toEqual({ compiled: false, errors: [boom] });
    expect(next).toEqual({ source: 'a', compiled: false, errors: [boom] });
  });

  it('is not compiled without an action even without errors', () => {
    const { result } = resolveCompiled(null, 'a', { ...fresh, action: null });
    expect(result.compiled).toBe(false);
  });
});

describe('resolveCompiled: unchanged source', () => {
  it('stays compiled after a successful compile of the same source (happy path)', () => {
    const memory: CompileMemory = { source: 'a', compiled: true, errors: [] };
    const { result, next } = resolveCompiled(memory, 'a', same);
    expect(result).toEqual({ compiled: true, errors: [] });
    expect(next).toBe(memory);
  });

  it('never claims success after a failed compile of the same source: returns the cached errors', () => {
    const memory: CompileMemory = { source: 'a', compiled: false, errors: [boom] };
    const { result, next } = resolveCompiled(memory, 'a', { ...same, ownedEntityId: 'e1' });
    expect(result).toEqual({ compiled: false, errors: [boom] });
    expect(next).toBe(memory);
  });

  it('without a remembered outcome is compiled only when an owned row exists', () => {
    const { result } = resolveCompiled(null, 'a', same);
    expect(result).toEqual({ compiled: true, errors: [] });
  });

  it('without a remembered outcome and without an owned row reports an unknown state, not compiled', () => {
    const { result, next } = resolveCompiled(null, 'a', { ...same, ownedEntityId: null });
    expect(result).toEqual({ compiled: false, errors: [], unknownState: true });
    expect(next).toBeNull();
  });

  it('with an outcome remembered only for a different source, a clean owned row still counts and the stale memory is dropped', () => {
    const memory: CompileMemory = { source: 'b', compiled: false, errors: [boom] };
    const { result, next } = resolveCompiled(memory, 'a', { ...same, ownedStatus: null });
    expect(result).toEqual({ compiled: true, errors: [] });
    expect(next).toBeNull();
  });

  it('without a usable memory never reports compiled when the owned row shows a compilation error', () => {
    const facts = { ...same, ownedStatus: 'Compilation error: CE10156 ?? Opened in Pine Editor' };
    expect(resolveCompiled(null, 'a', facts).result).toEqual({ compiled: false, errors: [], unknownState: true });
    const other: CompileMemory = { source: 'b', compiled: true, errors: [] };
    expect(resolveCompiled(other, 'a', facts).result.unknownState).toBe(true);
  });

  it('an UNKNOWN memory for the source is not trusted: the owned row status decides and the marker is kept', () => {
    const unknown: CompileMemory = { source: 'a', compiled: false, errors: [], unknown: true };
    const clean = resolveCompiled(unknown, 'a', { ...same, ownedStatus: null });
    expect(clean.result).toEqual({ compiled: true, errors: [] });
    expect(clean.next).toBe(unknown);
    const broken = resolveCompiled(unknown, 'a', { ...same, ownedStatus: 'Compilation error: CE10156' });
    expect(broken.result).toEqual({ compiled: false, errors: [], unknownState: true });
  });
});

describe('nextMemory (clearing rules)', () => {
  const failedS2: CompileMemory = { source: 'S2', compiled: false, errors: [boom] };

  it('keeps the memory when a different source is set (lookups are keyed by source)', () => {
    expect(nextMemory(failedS2, { kind: 'setScript' })).toBe(failedS2);
  });

  it('clears it on openChart, removeScript and the stall recovery', () => {
    for (const kind of ['openChart', 'removeScript', 'recovery'] as const) {
      expect(nextMemory(failedS2, { kind })).toBeNull();
    }
  });

  it('keeps it when a compile fails before it was triggered', () => {
    expect(nextMemory(failedS2, { kind: 'compileError', source: 'S3', triggered: false })).toBe(failedS2);
  });

  it('keeps the evidence for the same source when a triggered compile of it throws', () => {
    expect(nextMemory(failedS2, { kind: 'compileError', source: 'S2', triggered: true })).toBe(failedS2);
  });

  it('marks a different source UNKNOWN when its triggered compile throws', () => {
    expect(nextMemory(failedS2, { kind: 'compileError', source: 'S3', triggered: true })).toEqual({
      source: 'S3',
      compiled: false,
      errors: [],
      unknown: true,
    });
  });
});

describe('review sequences (pure level)', () => {
  const ok = { unchanged: false, errors: [], action: 'added', ownedEntityId: 'R', ownedStatus: null } as const;
  const bad = { unchanged: false, errors: [boom], action: null, ownedEntityId: 'R', ownedStatus: null } as const;
  const nothing = { unchanged: true, errors: [], action: null, ownedEntityId: 'R', ownedStatus: 'Compilation error: CE10156' } as const;

  it('A: S1 ok, S2 fails, S3 set without compiling, S2 unchanged -> never compiled', () => {
    let memory = resolveCompiled(null, 'S1', ok).next;
    memory = resolveCompiled(memory, 'S2', bad).next;
    memory = nextMemory(memory, { kind: 'setScript' });
    expect(resolveCompiled(memory, 'S2', nothing).result).toEqual({ compiled: false, errors: [boom] });
  });

  it('B: S1 ok, S2 fails, S3 compile throws after the trigger, S2 unchanged -> never compiled', () => {
    let memory = resolveCompiled(null, 'S1', ok).next;
    memory = resolveCompiled(memory, 'S2', bad).next;
    memory = nextMemory(memory, { kind: 'compileError', source: 'S3', triggered: true });
    expect(resolveCompiled(memory, 'S2', nothing).result).toEqual({ compiled: false, errors: [], unknownState: true });
  });

  it('B before the trigger: the S2 failure is still remembered', () => {
    let memory = resolveCompiled(null, 'S1', ok).next;
    memory = resolveCompiled(memory, 'S2', bad).next;
    memory = nextMemory(memory, { kind: 'compileError', source: 'S3', triggered: false });
    expect(resolveCompiled(memory, 'S2', nothing).result).toEqual({ compiled: false, errors: [boom] });
  });
});

describe('ownedAfterCompileError', () => {
  it('adopts the owned row a deadline timeout names (also null), so the bridge never loses or invents ownership', () => {
    const named = new TvError('TIMEOUT_COMPILE', 'budget', { reason: 'deadline', phase: 'row-settle', ownedEntityId: 'e2' });
    expect(ownedAfterCompileError(named, 'e1')).toBe('e2');
    const none = new TvError('TIMEOUT_COMPILE', 'budget', { reason: 'deadline', phase: 'owned-row', ownedEntityId: null });
    expect(ownedAfterCompileError(none, 'e1')).toBeNull();
  });

  it('keeps the current owned row for any other error', () => {
    expect(ownedAfterCompileError(new TvError('TIMEOUT_COMPILE', 'slow', { phase: 'outcome' }), 'e1')).toBe('e1');
    expect(ownedAfterCompileError(new TvError('TIMEOUT_REPORT', 'x', { ownedEntityId: 'e9' }), 'e1')).toBe('e1');
    expect(ownedAfterCompileError(new Error('boom'), null)).toBeNull();
  });
});

describe('memoryForSource', () => {
  it('keeps the memory only for the same source', () => {
    const memory: CompileMemory = { source: 'a', compiled: false, errors: [boom] };
    expect(memoryForSource(memory, 'a')).toBe(memory);
    expect(memoryForSource(memory, 'b')).toBeNull();
    expect(memoryForSource(null, 'a')).toBeNull();
  });
});

describe('recoveryCompileAccepted', () => {
  const rows = [
    { entityId: 'u1', title: 'Vol' },
    { entityId: 'n2', title: 'TV Bridge Smoke 10 30' },
  ];

  it('accepts a compiled re-compile', () => {
    expect(recoveryCompileAccepted({ compiled: true, errors: [] }, [], ['X'])).toBe(true);
  });

  it('accepts an unknown state only while a row matching the script names is on the chart', () => {
    const unknown = { compiled: false, errors: [], unknownState: true } as const;
    expect(recoveryCompileAccepted(unknown, rows, ['TV Bridge Smoke'])).toBe(true);
    expect(recoveryCompileAccepted(unknown, rows, ['Other'])).toBe(false);
    expect(recoveryCompileAccepted(unknown, rows, [])).toBe(false);
  });

  it('never accepts compile errors', () => {
    const failed = { compiled: false, errors: [boom] };
    expect(recoveryCompileAccepted(failed, rows, ['TV Bridge Smoke'])).toBe(false);
  });
});