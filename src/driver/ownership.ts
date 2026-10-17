export interface LegendRow {
  readonly entityId: string;
  readonly title: string;
  readonly status?: string | null;
}

export interface OwnershipArgs {
  readonly before: readonly LegendRow[];
  readonly after: readonly LegendRow[];
  /** Every non-empty name the script declares (title and/or short title); the legend shows either. */
  readonly scriptTitles: readonly string[];
  readonly previousOwned: string | null;
  /** Informational only: ownership never depends on it (an 'updated' action proves nothing about who added the row). */
  readonly action: 'added' | 'updated' | null;
}

/**
 * Ownership is claimed only for (i) the previously owned row while it still matches a script name, or
 * (ii) exactly one FRESH row (absent from `before`) matching a script name. Anything else is null, so
 * a pre-existing user row is never claimed by its title. A row matches when its legend title starts
 * with ANY of the names (TradingView shows the short title when one is declared).
 */
export function pickOwnedEntity(args: OwnershipArgs): string | null {
  const names = args.scriptTitles.filter((name) => name.length > 0);
  if (names.length === 0) return null;
  const matches = args.after.filter((row) => names.some((name) => row.title.startsWith(name)));
  if (args.previousOwned && matches.some((row) => row.entityId === args.previousOwned)) {
    return args.previousOwned;
  }
  const knownIds = new Set(args.before.map((row) => row.entityId));
  const fresh = matches.filter((row) => !knownIds.has(row.entityId));
  if (fresh.length === 1) return fresh[0]!.entityId;
  return null;
}

/** Keeps an owned id only while a legend row with exactly that id still exists. */
export function retainPresentOwned(owned: string | null, rows: readonly LegendRow[]): string | null {
  return owned !== null && rows.some((row) => row.entityId === owned) ? owned : null;
}
