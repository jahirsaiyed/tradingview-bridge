import { describe, it, expect } from 'vitest';
import { memoryForSource, resolveCompiled, type CompileMemory } from '../../src/driver/compileMemory.js';

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

  it('ignores an outcome remembered for a different source', () => {
    const memory: CompileMemory = { source: 'b', compiled: false, errors: [boom] };
    expect(resolveCompiled(memory, 'a', same).result).toEqual({ compiled: true, errors: [] });
    expect(resolveCompiled(memory, 'a', { ...same, ownedEntityId: null }).result.unknownState).toBe(true);
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
