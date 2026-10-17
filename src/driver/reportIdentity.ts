import { TvError } from '../result.js';

export interface ReportIdentity {
  /** The strategy name the Strategy Tester shows for the displayed report, null when it could not be read. */
  readonly strategyName: string | null;
  /** true/false when both the shown name and the owned script's names are known, otherwise null. */
  readonly matchesOwnedScript: boolean | null;
}

const ELLIPSIS = /(?:\.\.\.|\u2026)$/;

/** nbsp to space, whitespace runs collapsed, trimmed, lower case. */
function normalizeName(name: string): string {
  return name.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Equal after normalizing, or the shown name ends with an ellipsis and the script name starts with the rest. */
function nameMatches(shown: string, name: string): boolean {
  if (!ELLIPSIS.test(shown)) return shown === name;
  const prefix = shown.replace(ELLIPSIS, '').trim();
  return prefix.length > 0 && name.startsWith(prefix);
}

/**
 * Compares the name the Strategy Tester footer shows with the owned script's title and short title.
 * The footer shows the name without inputs, so a longer name (e.g. "Name v2") is a mismatch.
 */
export function matchesOwnedScript(shown: string | null, names: readonly string[]): boolean | null {
  const name = normalizeName(shown ?? '');
  const known = names.map(normalizeName).filter((candidate) => candidate.length > 0);
  if (name.replace(ELLIPSIS, '').trim() === '' || known.length === 0) return null;
  return known.some((candidate) => nameMatches(name, candidate));
}

/** The report identity, or FOREIGN_REPORT when the Strategy Tester shows another strategy. */
export function assertOwnedReport(shown: string | null, names: readonly string[]): ReportIdentity {
  const strategyName = shown?.trim() || null;
  const matches = matchesOwnedScript(strategyName, names);
  if (matches === false) {
    throw new TvError(
      'FOREIGN_REPORT',
      `The Strategy Tester is showing another strategy ("${strategyName}"), not the script this bridge set, ` +
        'so the bridge will not return its numbers. Compile the bridge script (tv_compile) or select it in the ' +
        'Strategy Tester, then retry.',
      { strategyName, ownedScriptNames: [...names] },
    );
  }
  return { strategyName, matchesOwnedScript: matches };
}
