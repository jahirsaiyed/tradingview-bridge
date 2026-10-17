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
