import { describe, expect, it } from 'vitest';
import type { UnitDto } from '@plantry/shared';
import { defaultWindowFor, errorMessage, formatQty } from './format';

const unit = (p: Partial<UnitDto>): UnitDto => ({ id: 'u', name: 'can', pluralName: 'cans', abbreviation: null, global: true, ...p });

describe('formatQty', () => {
  it('pluralises, prefers abbreviations, trims trailing zeros', () => {
    expect(formatQty(1, unit({}))).toBe('1 can');
    expect(formatQty(2, unit({}))).toBe('2 cans');
    expect(formatQty(-3, unit({}))).toBe('-3 cans');
    expect(formatQty(1.5, unit({ name: 'lb', pluralName: 'lb', abbreviation: 'lb' }))).toBe('1.5 lb');
    expect(formatQty(2, unit({ pluralName: null }))).toBe('2 can');
  });
});

describe('defaultWindowFor', () => {
  it('is the smallest window ≥ 2× the auto-deduct period, else 30d', () => {
    expect(defaultWindowFor(1, true)).toBe('30d');
    expect(defaultWindowFor(90, true)).toBe('183d');
    expect(defaultWindowFor(100, true)).toBe('365d');
    expect(defaultWindowFor(400, true)).toBe('365d');
    expect(defaultWindowFor(90, false)).toBe('30d');
  });
});

describe('errorMessage', () => {
  it('reads the API envelope', () => {
    expect(errorMessage({ status: 409, data: { error: { code: 'last_owner', message: 'Assign another owner first' } } })).toBe('Assign another owner first');
    expect(errorMessage(new Error('x'))).toBe('Something went wrong');
  });
});
