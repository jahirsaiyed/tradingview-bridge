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
  it('parses proper comma groups and numbers without separators', () => {
    expect(parseNumber('1,234,567.89')).toBe(1234567.89);
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('1234567.89')).toBe(1234567.89);
    expect(parseNumber('-1,234.5')).toBe(-1234.5);
    expect(parseNumber('+1,000')).toBe(1000);
  });
  it('expands K/M/B on grouped numbers and B', () => {
    expect(parseNumber('1,234.5K')).toBe(1234500);
    expect(parseNumber('2B')).toBe(2e9);
    expect(parseNumber('10.43 K')).toBe(10430);
  });
  it('rejects locale-ambiguous or malformed separators instead of misreading them', () => {
    expect(parseNumber('1,2,3')).toBeNull();
    expect(parseNumber('1.234,56')).toBeNull();
    expect(parseNumber('1 234,56')).toBeNull();
    expect(parseNumber('1 234')).toBeNull();
    expect(parseNumber(',5')).toBeNull();
    expect(parseNumber('12,5')).toBeNull();
    expect(parseNumber('1,2345')).toBeNull();
    expect(parseNumber('1234,567')).toBeNull();
    expect(parseNumber('1,234,56')).toBeNull();
    expect(parseNumber('1,')).toBeNull();
    expect(parseNumber('1.2.3')).toBeNull();
  });
  it('keeps full precision for long numbers (no rounding to 12 digits)', () => {
    expect(parseNumber('123456789012345')).toBe(123456789012345);
    expect(parseNumber('12345678901234.5')).toBe(12345678901234.5);
    expect(parseNumber('1.23456789012345')).toBe(1.23456789012345);
  });
});

describe('parseMoney', () => {
  it('parses signed amounts with a currency unit', () => {
    expect(parseMoney('\u221247.67 USD')).toEqual({ value: -47.67, unit: 'USD' });
  });
  it('accepts a separate K/M/B magnitude before a separate currency code', () => {
    expect(parseMoney('1.2K USD')).toEqual({ value: 1200, unit: 'USD' });
    expect(parseMoney('2.5 M USD')).toEqual({ value: 2500000, unit: 'USD' });
  });
  it('never splits a letter run: the whole run is the currency code', () => {
    expect(parseMoney('5 BUSD')).toEqual({ value: 5, unit: 'BUSD' });
    expect(parseMoney('10 MANA')).toEqual({ value: 10, unit: 'MANA' });
    expect(parseMoney('10.43 KUSD')).toEqual({ value: 10.43, unit: 'KUSD' });
    expect(parseMoney('5 USDT')).toEqual({ value: 5, unit: 'USDT' });
  });
  it('returns null without a unit', () => {
    expect(parseMoney('12')).toBeNull();
  });
  it('returns null for an ambiguous amount instead of a wrong number', () => {
    expect(parseMoney('1.234,56 USD')).toBeNull();
    expect(parseMoney('1,2,3 USD')).toBeNull();
    expect(parseMoney('1,234.56 USD')).toEqual({ value: 1234.56, unit: 'USD' });
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
  it('returns null for a decimal-comma percent', () => {
    expect(parsePercent('12,5%')).toBeNull();
  });
});
