import { describe, it, expect } from 'vitest';
import { parseConsoleEntries, parseProblemCodes, analyzeCompile } from '../../src/parsers/console.js';

const PANEL = [
  'Pine Editor',
  'Untitled script',
  '1 of 1 problem',
  'Syntax error at input ")"(CE10156)',
  '12:57:39 PM\t"Untitled script" opened',
  '1:02:05 PM\tCompiling...',
  '1:02:05 PM\tCompiled.',
  '1:02:05 PM\tUpdated on chart.',
  '1:01:44 PM\tError at 7:16 Syntax error at input ")"',
  'Line 7, Col 16',
  'Pine Script\u00ae v6',
].join('\n');

describe('parseConsoleEntries', () => {
  it('keeps only timestamped console lines', () => {
    const entries = parseConsoleEntries(PANEL);
    expect(entries.map((e) => e.message)).toEqual([
      '"Untitled script" opened',
      'Compiling...',
      'Compiled.',
      'Updated on chart.',
      'Error at 7:16 Syntax error at input ")"',
    ]);
    expect(entries[0]!.time).toBe('12:57:39 PM');
  });

  it('accepts a 24-hour clock without AM/PM', () => {
    expect(parseConsoleEntries('13:02:05\tCompiled.\n9:00:01 Added to chart.')).toEqual([
      { time: '13:02:05', message: 'Compiled.' },
      { time: '9:00:01', message: 'Added to chart.' },
    ]);
  });

  it('still accepts a 12-hour clock line', () => {
    expect(parseConsoleEntries('1:02:05 PM\tCompiled.')).toEqual([{ time: '1:02:05 PM', message: 'Compiled.' }]);
  });
});

describe('parseProblemCodes', () => {
  it('extracts message and code from the problems list', () => {
    expect(parseProblemCodes(PANEL)).toEqual([{ message: 'Syntax error at input ")"', code: 'CE10156' }]);
  });
});

describe('analyzeCompile', () => {
  const entry = (message: string) => ({ time: '1:00:00 PM', message });

  it('reports a first add as added', () => {
    const outcome = analyzeCompile([entry('Compiling...'), entry('Compiled.'), entry('Added to chart.')]);
    expect(outcome).toMatchObject({ finished: true, compiled: true, action: 'added', errors: [] });
  });

  it('reports a re-run as updated', () => {
    const outcome = analyzeCompile([entry('Compiling...'), entry('Compiled.'), entry('Updated on chart.')]);
    expect(outcome.action).toBe('updated');
  });

  it('parses an error with its problem code', () => {
    const outcome = analyzeCompile(
      [entry('Compiling...'), entry('Error at 7:16 Syntax error at input ")"')],
      [{ message: 'Syntax error at input ")"', code: 'CE10156' }],
    );
    expect(outcome.finished).toBe(true);
    expect(outcome.compiled).toBe(false);
    expect(outcome.errors).toEqual([
      { line: 7, column: 16, message: 'Syntax error at input ")"', code: 'CE10156' },
    ]);
  });

  it('omits code when the problems list has no match', () => {
    const outcome = analyzeCompile([entry('Error at 1:1 boom')]);
    expect(outcome.errors).toEqual([{ line: 1, column: 1, message: 'boom' }]);
  });

  it('is not finished while only Compiling... is present', () => {
    expect(analyzeCompile([entry('Compiling...')]).finished).toBe(false);
  });

  it('is not finished when compiled but not yet added or updated', () => {
    expect(analyzeCompile([entry('Compiling...'), entry('Compiled.')]).finished).toBe(false);
  });

  it('collects warnings (format assumed, not yet observed live)', () => {
    const outcome = analyzeCompile([entry('Compiled.'), entry('Warning at 3:4 careful'), entry('Added to chart.')]);
    expect(outcome.warnings).toEqual([{ line: 3, column: 4, message: 'careful' }]);
  });
});
