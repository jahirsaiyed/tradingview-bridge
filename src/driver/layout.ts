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
