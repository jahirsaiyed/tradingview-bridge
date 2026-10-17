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
