import { describe, expect, it } from 'vitest';
import {
  RATE_WINDOWS, windowDays, rateWindowSchema, restockSchema, consumeSchema,
  itemCreateSchema, itemUpdateSchema, shoppingAddSchema, photoUploadSchema,
  stepSchema, unitCreateSchema, unitUpdateSchema, barcodesSchema,
} from './index.js';

describe('rate windows', () => {
  it('is the fixed enum', () => {
    expect(RATE_WINDOWS).toEqual(['30d', '60d', '90d', '183d', '365d']);
    expect(windowDays('183d')).toBe(183);
  });
  it('rejects anything else', () => {
    expect(rateWindowSchema.safeParse('7d').success).toBe(false);
    expect(rateWindowSchema.safeParse('90d').success).toBe(true);
  });
});

describe('quantities', () => {
  it('rejects zero, negatives and >3 decimals', () => {
    expect(restockSchema.safeParse({ quantity: 0 }).success).toBe(false);
    expect(restockSchema.safeParse({ quantity: -1 }).success).toBe(false);
    expect(restockSchema.safeParse({ quantity: 1.2345 }).success).toBe(false);
    expect(restockSchema.safeParse({ quantity: 1.234 }).success).toBe(true);
  });
  it('consume has no default; quantity is resolved server-side', () => {
    expect(consumeSchema.parse({}).quantity).toBeUndefined();
  });
});

describe('unit step', () => {
  it('accepts >= 0.01 with at most 2 decimal places', () => {
    expect(stepSchema.safeParse(0.01).success).toBe(true);
    expect(stepSchema.safeParse(8).success).toBe(true);
    expect(stepSchema.safeParse(0.1).success).toBe(true);
  });
  it('rejects 0.001, 0, negatives and 3dp values', () => {
    expect(stepSchema.safeParse(0.001).success).toBe(false);
    expect(stepSchema.safeParse(0).success).toBe(false);
    expect(stepSchema.safeParse(-1).success).toBe(false);
    expect(stepSchema.safeParse(0.125).success).toBe(false);
  });

  it('unit create defaults step to 1', () => {
    expect(unitCreateSchema.parse({ name: 'Can' }).step).toBe(1);
  });
  it('unit create accepts an explicit step', () => {
    expect(unitCreateSchema.parse({ name: 'Case', step: 8 }).step).toBe(8);
  });
  it('unit update applies NO defaults', () => {
    expect(unitUpdateSchema.parse({})).toEqual({});
  });
});

describe('items', () => {
  const unitId = '7b0f7a3c-8a53-4bd1-9d0e-3f0a3d1f6a11';
  it('applies create defaults', () => {
    const v = itemCreateSchema.parse({ name: ' Cat food ', unitId });
    expect(v).toMatchObject({
      name: 'Cat food', renotifyAfterDays: 7, defaultRestockQty: 1,
      autoDeductPeriodDays: 1, autoDeductPaused: false, currentCount: 0, minStock: 0,
    });
  });
  it('update applies NO defaults', () => {
    expect(itemUpdateSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
  });
  it('update rejects currentCount (use adjust)', () => {
    expect(itemUpdateSchema.safeParse({ currentCount: 5 }).success).toBe(false);
  });

  it('barcodes default to an empty list on create', () => {
    const v = itemCreateSchema.parse({ name: 'Cat food', unitId });
    expect(v.barcodes).toEqual([]);
  });
  it('barcodes are trimmed', () => {
    const v = itemCreateSchema.parse({ name: 'Cat food', unitId, barcodes: [' 123 '] });
    expect(v.barcodes).toEqual(['123']);
  });
  it('barcodes are de-duplicated (case-sensitive)', () => {
    const v = itemCreateSchema.parse({ name: 'Cat food', unitId, barcodes: ['123', '123', 'ABC', 'abc'] });
    expect(v.barcodes).toEqual(['123', 'ABC', 'abc']);
  });
  it('rejects more than 20 barcodes', () => {
    const many = Array.from({ length: 21 }, (_, i) => `code-${i}`);
    expect(itemCreateSchema.safeParse({ name: 'Cat food', unitId, barcodes: many }).success).toBe(false);
  });
  it('rejects an empty-string barcode', () => {
    expect(itemCreateSchema.safeParse({ name: 'Cat food', unitId, barcodes: [''] }).success).toBe(false);
  });
  it('update with {} applies no defaults (barcodes stays absent)', () => {
    expect(itemUpdateSchema.parse({})).toEqual({});
  });
  it('trackLow defaults to true on create', () => {
    const v = itemCreateSchema.parse({ name: 'Cat food', unitId });
    expect(v.trackLow).toBe(true);
  });
  it('trackLow can be set to false on create', () => {
    const v = itemCreateSchema.parse({ name: 'Cat food', unitId, trackLow: false });
    expect(v.trackLow).toBe(false);
  });
  it('update applies no default for trackLow (stays absent)', () => {
    expect(itemUpdateSchema.parse({})).toEqual({});
  });
  it('update accepts an explicit trackLow', () => {
    expect(itemUpdateSchema.parse({ trackLow: false }).trackLow).toBe(false);
  });
  it('update accepts an explicit barcodes list', () => {
    expect(itemUpdateSchema.parse({ barcodes: ['1', '2'] }).barcodes).toEqual(['1', '2']);
  });
});

describe('barcodesSchema', () => {
  it('de-dupes and caps at 20, trims each code', () => {
    expect(barcodesSchema.parse([' a ', 'a', 'b'])).toEqual(['a', 'b']);
    expect(barcodesSchema.safeParse(Array.from({ length: 21 }, (_, i) => `${i}`)).success).toBe(false);
  });
});

describe('shopping add', () => {
  it('accepts item-linked or free-text, not both', () => {
    const itemId = '7b0f7a3c-8a53-4bd1-9d0e-3f0a3d1f6a11';
    expect(shoppingAddSchema.safeParse({ itemId }).success).toBe(true);
    expect(shoppingAddSchema.safeParse({ name: 'candles' }).success).toBe(true);
    expect(shoppingAddSchema.safeParse({ itemId, name: 'x' }).success).toBe(false);
    expect(shoppingAddSchema.safeParse({}).success).toBe(false);
  });
});

describe('photo upload', () => {
  it('enforces jpeg and size caps', () => {
    const ok = { mimeType: 'image/jpeg', sizeBytes: 5 * 1024 * 1024, thumbSizeBytes: 200 * 1024 };
    expect(photoUploadSchema.safeParse(ok).success).toBe(true);
    expect(photoUploadSchema.safeParse({ ...ok, mimeType: 'image/png' }).success).toBe(false);
    expect(photoUploadSchema.safeParse({ ...ok, sizeBytes: ok.sizeBytes + 1 }).success).toBe(false);
  });
});
