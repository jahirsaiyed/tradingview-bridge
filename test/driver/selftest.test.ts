import { describe, it, expect } from 'vitest';
import { summarizeChecks, type SelectorCheck } from '../../src/driver/selftest.js';

const check = (name: string, found: boolean, required: boolean): SelectorCheck => ({
  name,
  selector: `#${name}`,
  found,
  required,
});

describe('summarizeChecks', () => {
  it('lists only required checks that were not found', () => {
    const failures = summarizeChecks([
      check('overlayRoot', true, true),
      check('editorSurface', false, true),
      check('reportTab', false, false),
    ]);
    expect(failures).toEqual(['editorSurface']);
  });

  it('returns an empty list when everything required is present', () => {
    expect(summarizeChecks([check('a', true, true), check('b', false, false)])).toEqual([]);
  });
});
