export interface ScriptNames {
  readonly title: string | null;
  readonly shortTitle: string | null;
}

type Token =
  | { readonly kind: 'str'; readonly value: string }
  | { readonly kind: 'ident'; readonly value: string }
  | { readonly kind: 'punct'; readonly value: string };

const DECLARATIONS = new Set(['indicator', 'strategy', 'library']);
const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t' };
const NO_NAMES: ScriptNames = { title: null, shortTitle: null };

/** Reads a quoted literal starting at `start`; null when it is not terminated on its line. */
function readString(source: string, start: number): { value: string; end: number } | null {
  const quote = source[start]!;
  let value = '';
  for (let i = start + 1; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === quote) return { value, end: i + 1 };
    if (ch === '\n') return null;
    if (ch === '\\' && i + 1 < source.length) {
      i += 1;
      value += ESCAPES[source[i]!] ?? source[i]!;
    } else {
      value += ch;
    }
  }
  return null;
}

/** Index just past a comment starting at `i`, or `i` when no comment starts there. */
function skipComment(source: string, i: number): number {
  if (source.startsWith('//', i)) {
    const end = source.indexOf('\n', i);
    return end < 0 ? source.length : end;
  }
  if (source.startsWith('/*', i)) {
    const end = source.indexOf('*/', i + 2);
    return end < 0 ? source.length : end + 2;
  }
  return i;
}

/** Tokens without comments or whitespace; null when a string literal is not terminated. */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    const afterComment = skipComment(source, i);
    if (afterComment !== i) {
      i = afterComment;
    } else if (ch === '"' || ch === "'") {
      const literal = readString(source, i);
      if (!literal) return null;
      tokens.push({ kind: 'str', value: literal.value });
      i = literal.end;
    } else if (IDENT_START.test(ch)) {
      let end = i + 1;
      while (end < source.length && IDENT_PART.test(source[end]!)) end += 1;
      tokens.push({ kind: 'ident', value: source.slice(i, end) });
      i = end;
    } else {
      if (!/\s/.test(ch)) tokens.push({ kind: 'punct', value: ch });
      i += 1;
    }
  }
  return tokens;
}

const isPunct = (token: Token | undefined, value: string): boolean =>
  token?.kind === 'punct' && token.value === value;

/** Index of the first `indicator(` / `strategy(` / `library(` call (not `strategy.entry(`), or -1. */
function findDeclaration(tokens: readonly Token[]): number {
  return tokens.findIndex(
    (token, i) =>
      token.kind === 'ident' &&
      DECLARATIONS.has(token.value) &&
      isPunct(tokens[i + 1], '(') &&
      !isPunct(tokens[i - 1], '.'),
  );
}

/** Top-level arguments of the call whose `(` is at `open`; null when the call is not closed. */
function splitArguments(tokens: readonly Token[], open: number): Token[][] | null {
  const args: Token[][] = [[]];
  let depth = 0;
  for (let i = open + 1; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.kind === 'punct' && '([{'.includes(token.value)) depth += 1;
    if (token.kind === 'punct' && ')]}'.includes(token.value)) {
      if (depth === 0) return args.filter((arg) => arg.length > 0);
      depth -= 1;
    }
    if (depth === 0 && isPunct(token, ',')) args.push([]);
    else args[args.length - 1]!.push(token);
  }
  return null;
}

/** The value of an argument when it is exactly one string literal, otherwise null (never guessed). */
function literalValue(tokens: readonly Token[]): string | null {
  const only = tokens.length === 1 ? tokens[0]! : null;
  return only?.kind === 'str' ? only.value : null;
}

/** `name = value` (not `==`): returns the name and the value tokens, or null for a positional argument. */
function namedArgument(arg: readonly Token[]): { name: string; value: Token[] } | null {
  const [first, second, third] = arg;
  if (first?.kind !== 'ident' || !isPunct(second, '=') || isPunct(third, '=')) return null;
  return { name: first.value, value: arg.slice(2) };
}

function namesFromArguments(args: readonly Token[][], allowShortTitle: boolean): ScriptNames {
  const positional: Array<string | null> = [];
  const named = new Map<string, string | null>();
  for (const arg of args) {
    const pair = namedArgument(arg);
    if (pair) named.set(pair.name, literalValue(pair.value));
    else positional.push(literalValue(arg));
  }
  const title = named.has('title') ? named.get('title')! : (positional[0] ?? null);
  const short = named.has('shorttitle') ? named.get('shorttitle')! : (positional[1] ?? null);
  return { title, shortTitle: allowShortTitle ? short : null };
}

/**
 * Names declared by the FIRST real indicator()/strategy()/library() call, ignoring comments and
 * string literals. A name that is not a plain string literal is null: it is never guessed.
 */
export function extractScriptNames(source: string): ScriptNames {
  const tokens = tokenize(source);
  const at = tokens ? findDeclaration(tokens) : -1;
  if (!tokens || at < 0) return NO_NAMES;
  const args = splitArguments(tokens, at + 1);
  if (!args) return NO_NAMES;
  return namesFromArguments(args, tokens[at]!.value !== 'library');
}

/** Every non-empty declared name (title first, then short title), without duplicates. */
export function scriptTitles(source: string): string[] {
  const { title, shortTitle } = extractScriptNames(source);
  return [...new Set([title, shortTitle].filter((name): name is string => !!name))];
}

export function normalizeSource(source: string): string {
  return source.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trimEnd();
}

export function sourcesEqual(a: string, b: string): boolean {
  return normalizeSource(a) === normalizeSource(b);
}
