import { describe, expect, it } from 'vitest';
import { uuidParam } from './ids.js';

describe('uuidParam', () => {
  it('lower-cases a valid UUID regardless of input casing', () => {
    const upper = 'A1B2C3D4-E5F6-4789-8ABC-DEF012345678';
    expect(uuidParam(upper)).toBe(upper.toLowerCase());
  });
});
