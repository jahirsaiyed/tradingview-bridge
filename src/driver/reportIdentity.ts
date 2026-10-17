import { TvError } from '../result.js';
import { titleMatches } from './ownership.js';

export interface ReportIdentity {
  /** The strategy name the Strategy Tester shows for the displayed report, null when it could not be read. */
  readonly strategyName: string | null;
  /** true/false when both the shown name and the owned script's names are known, otherwise null. */
  readonly matchesOwnedScript: boolean | null;
}

/** Same word-boundary comparison as legend ownership, against the title and the short title. */
export function matchesOwnedScript(shown: string | null, names: readonly string[]): boolean | null {
  const name = shown?.trim() ?? '';
  const known = names.filter((candidate) => candidate.length > 0);
  if (name === '' || known.length === 0) return null;
  return known.some((candidate) => titleMatches(name, candidate));
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
