import { describe, expect, it } from 'vitest';
import { cacheForSource, resolveRuntime } from '../../src/driver/runtimeCache.js';

const RE = { present: true, code: 'RE1' } as const;
const fresh = { unchanged: false, hasErrors: false, runtimeError: RE, runtimeChecked: true };
const same = { unchanged: true, hasErrors: false, runtimeError: { present: false } as const, runtimeChecked: false };

describe('runtimeCache', () => {
  it('stores the runtime error of a fresh compile', () => {
    const { view, next } = resolveRuntime(null, 'a', fresh);
    expect(view).toEqual({ runtimeError: RE, runtimeChecked: true });
    expect(next).toEqual({ source: 'a', runtimeError: RE });
  });

  it('returns the cached runtime error for an unchanged source, unchecked', () => {
    const cache = { source: 'a', runtimeError: RE };
    const { view, next } = resolveRuntime(cache, 'a', same);
    expect(view).toEqual({ runtimeError: RE, runtimeChecked: false });
    expect(next).toBe(cache);
  });

  it('reports no runtime error when unchanged without a matching cache', () => {
    const { view, next } = resolveRuntime({ source: 'b', runtimeError: RE }, 'a', same);
    expect(view).toEqual({ runtimeError: { present: false }, runtimeChecked: false });
    expect(next).toBeNull();
  });

  it('lets a fresh read on an unchanged source override the cache (checked)', () => {
    const cache = { source: 'a', runtimeError: { present: false } as const };
    const { view, next } = resolveRuntime(cache, 'a', { ...same, runtimeError: RE, runtimeChecked: true });
    expect(view).toEqual({ runtimeError: RE, runtimeChecked: true });
    expect(next).toEqual({ source: 'a', runtimeError: RE });
  });

  it('keeps the cache, unchecked, for an unchanged source without an owned row read', () => {
    const cache = { source: 'a', runtimeError: { present: false } as const };
    const { view, next } = resolveRuntime(cache, 'a', same);
    expect(view).toEqual({ runtimeError: { present: false }, runtimeChecked: false });
    expect(next).toBe(cache);
  });

  it('keeps the previous cache after a failed compile', () => {
    const cache = { source: 'b', runtimeError: RE };
    const { next } = resolveRuntime(cache, 'a', { ...fresh, hasErrors: true, runtimeError: { present: false } });
    expect(next).toBe(cache);
  });

  it('drops the cache for a different source', () => {
    expect(cacheForSource({ source: 'a', runtimeError: RE }, 'b')).toBeNull();
  });
});
