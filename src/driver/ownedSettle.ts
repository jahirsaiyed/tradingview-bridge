import type { RowSettleResult } from './rowSettle.js';

export const OWNED_ROW_PICKS = 3;

export interface OwnedSettleDeps {
  /** Picks the owned legend row (bounded); null when none can be claimed. */
  readonly find: () => Promise<string | null>;
  readonly settle: (entityId: string) => Promise<RowSettleResult>;
  /** One more legend listing after settling: is the row still on the chart? */
  readonly isPresent: (entityId: string) => Promise<boolean>;
}

/**
 * The first add shows a transient legend row that TradingView replaces (new entity id) after ~0.6 s.
 * A picked row that vanished while settling, or is gone right after settling, is picked again, at
 * most `picks` times in total.
 */
export async function settleOwned(
  deps: OwnedSettleDeps,
  picks: number = OWNED_ROW_PICKS,
): Promise<{ owned: string | null; status: RowSettleResult | null }> {
  for (let pick = 0; pick < picks; pick += 1) {
    const owned = await deps.find();
    if (!owned) return { owned: null, status: null };
    const status = await deps.settle(owned);
    if (status.present && (await deps.isPresent(owned))) return { owned, status };
  }
  return { owned: null, status: null };
}
