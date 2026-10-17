import { describe, it, expect } from 'vitest';
import { normalizeText, parseNumber, parseMoney, parsePercent } from '../../src/parsers/numbers.js';

describe('normalizeText', () => {
  it('converts nbsp and unicode minus and collapses whitespace', () => {
    expect(normalizeText('  \u221247.67\u00a0 USD\n\t x ')).toBe('-47.67 USD x');
  });
});

describe('parseNumber', () => {
  it('parses unicode minus with thousands separators', () => {
    expect(parseNumber('\u22121,234.56')).toBe(-1234.56);
  });
  it('parses an explicit plus sign', () => {
    expect(parseNumber('+7.95')).toBe(7.95);
  });
  it('expands K and M suffixes with or without a space', () => {
    expect(parseNumber('9.25 K')).toBe(9250);
    expect(parseNumber('10.38K')).toBe(10380);
    expect(parseNumber('1.5M')).toBe(1500000);
  });
  it('returns null for non-numbers', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('\u2014')).toBeNull();
  });
});

describe('parseMoney', () => {
  it('parses signed amounts with a currency unit', () => {
    expect(parseMoney('\u221247.67 USD')).toEqual({ value: -47.67, unit: 'USD' });
  });
  it('parses a magnitude suffix glued to the unit', () => {
    expect(parseMoney('10.43 KUSD')).toEqual({ value: 10430, unit: 'USD' });
  });
  it('returns null without a unit', () => {
    expect(parseMoney('12')).toBeNull();
  });
});

describe('parsePercent', () => {
  it('parses plain and spaced percents', () => {
    expect(parsePercent('34.01%')).toBe(34.01);
    expect(parsePercent('\u22120.46 %')).toBe(-0.46);
  });
  it('returns null for a dash', () => {
    expect(parsePercent('\u2014')).toBeNull();
  });
});
