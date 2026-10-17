const TITLE_PATTERN =
  /\b(?:indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?(["'])((?:(?!\1)[^\\]|\\.)*)\1/;

export function extractScriptTitle(source: string): string | null {
  const match = TITLE_PATTERN.exec(source);
  return match ? match[2]!.replace(/\\(["'\\])/g, '$1') : null;
}

export function normalizeSource(source: string): string {
  return source.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trimEnd();
}

export function sourcesEqual(a: string, b: string): boolean {
  return normalizeSource(a) === normalizeSource(b);
}
