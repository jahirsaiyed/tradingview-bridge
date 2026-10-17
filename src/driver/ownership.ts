export interface LegendRow {
  readonly entityId: string;
  readonly title: string;
  readonly status?: string | null;
}

export interface OwnershipArgs {
  readonly before: readonly LegendRow[];
  readonly after: readonly LegendRow[];
  readonly scriptTitle: string | null;
  readonly previousOwned: string | null;
  /** Informational only: ownership never depends on it (an 'updated' action proves nothing about who added the row). */
  readonly action: 'added' | 'updated' | null;
}

/**
 * Ownership is claimed only for (i) the previously owned row while it still matches the title, or
 * (ii) exactly one FRESH row (absent from `before`) matching the title. Anything else is null, so a
 * pre-existing user row is never claimed by its title.
 */
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
  return null;
}

/** Keeps an owned id only while a legend row with exactly that id still exists. */
export function retainPresentOwned(owned: string | null, rows: readonly LegendRow[]): string | null {
  return owned !== null && rows.some((row) => row.entityId === owned) ? owned : null;
}
