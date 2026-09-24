import { z } from 'zod';
import { PHOTO_MAX_BYTES, RATE_WINDOWS, THUMB_MAX_BYTES } from './constants.js';

const threeDp = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
const MAX = 999_999_999;
export const qtySchema = z.number().finite().positive().max(MAX).refine(threeDp, 'max 3 decimal places');
export const countSchema = z.number().finite().min(-MAX).max(MAX).refine(threeDp, 'max 3 decimal places');
const nonNegSchema = z.number().finite().min(0).max(MAX).refine(threeDp, 'max 3 decimal places');
const twoDp = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
export const stepSchema = z.number().finite().min(0.01).max(1_000_000).refine(twoDp, 'max 2 decimal places');
const nameSchema = z.string().trim().min(1).max(120);
const noteSchema = z.string().trim().max(500).nullish();
const uuid = z.string().uuid();

export const householdNameSchema = z.object({ name: nameSchema }).strict();
export const memberRoleSchema = z.object({ role: z.enum(['owner', 'member']) }).strict();

export const storeCreateSchema = z.object({ name: nameSchema, notes: noteSchema }).strict();
export const storeUpdateSchema = storeCreateSchema.partial();

const unitFields = {
  name: z.string().trim().min(1).max(40),
  pluralName: z.string().trim().min(1).max(40).nullish(),
  abbreviation: z.string().trim().min(1).max(12).nullish(),
  step: stepSchema,
};
export const unitCreateSchema = z.object({
  ...unitFields,
  step: unitFields.step.default(1),
}).strict();
export const unitUpdateSchema = z.object(unitFields).partial().strict();

export const barcodeSchema = z.string().trim().min(1).max(64);
export const barcodesSchema = z.array(barcodeSchema).max(20).transform((list) => [...new Set(list)]);

const itemFields = {
  name: nameSchema,
  description: z.string().trim().max(1000).nullish(),
  category: z.string().trim().min(1).max(60).nullish(),
  unitId: uuid,
  preferredStoreId: uuid.nullish(),
  barcodes: barcodesSchema,
  renotifyAfterDays: z.number().int().min(1).max(365),
  defaultRestockQty: qtySchema,
  autoDeductQty: qtySchema.nullish(),
  autoDeductPeriodDays: z.number().int().min(1).max(3650),
  autoDeductPaused: z.boolean(),
  minStock: nonNegSchema,
};
export const itemCreateSchema = z.object({
  ...itemFields,
  barcodes: itemFields.barcodes.default([]),
  renotifyAfterDays: itemFields.renotifyAfterDays.default(7),
  defaultRestockQty: itemFields.defaultRestockQty.default(1),
  autoDeductPeriodDays: itemFields.autoDeductPeriodDays.default(1),
  autoDeductPaused: itemFields.autoDeductPaused.default(false),
  minStock: itemFields.minStock.default(0),
  currentCount: countSchema.default(0),
}).strict();
export const itemUpdateSchema = z.object(itemFields).partial().strict();

export const restockSchema = z.object({ quantity: qtySchema, note: noteSchema }).strict();
export const consumeSchema = z.object({ quantity: qtySchema.optional(), note: noteSchema }).strict();
export const adjustSchema = z.object({ newCount: countSchema, note: noteSchema }).strict();

export const rateWindowSchema = z.enum(RATE_WINDOWS);

export const consolidateSchema = z.object({
  sourceId: uuid,
  keepMinStockFrom: z.enum(['target', 'source']).default('target'),
}).strict();

export const shoppingAddSchema = z.union([
  z.object({ itemId: uuid, quantity: qtySchema.nullish() }).strict(),
  z.object({ name: nameSchema, storeId: uuid.nullish(), quantity: qtySchema.nullish() }).strict(),
]);
export const shoppingPatchSchema = z.object({ checkedOff: z.boolean() }).strict();
export const purchaseSchema = z.object({ quantity: qtySchema.optional() }).strict();

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(200) }),
}).strict();
export const pushUnsubscribeSchema = z.object({ endpoint: z.string().url().max(2000) }).strict();

export const photoUploadSchema = z.object({
  mimeType: z.literal('image/jpeg'),
  sizeBytes: z.number().int().min(1).max(PHOTO_MAX_BYTES),
  thumbSizeBytes: z.number().int().min(1).max(THUMB_MAX_BYTES),
}).strict();
export const photoFinalizeSchema = z.object({ key: z.string().min(1).max(300) }).strict();

export const feedbackSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  pageUrl: z.string().max(500).optional(),
}).strict();

export type ItemCreateInput = z.infer<typeof itemCreateSchema>;
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;
export type ShoppingAddInput = z.infer<typeof shoppingAddSchema>;
