import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';
import { applyEvent } from './inventory.js';
import { consumptionRates } from './rates.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

const NOW = new Date('2026-09-01T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('consumption rates', () => {
  async function seed() {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.prisma.item.create({
      data: { householdId: hid, name: 'Old item', inventory: { create: {} },
        unitId: (await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } })).id },
    });
    const ev = (eventType: any, quantity: number, at: Date) => ctx.prisma.$transaction((tx) =>
      applyEvent(tx, { itemId: item.id, householdId: hid, eventType, quantity, userSub: null, now: at }));
    return { u, hid, item, ev };
  }

  it('sums consume + auto_deduct only, over the full window for old items', async () => {
    const { hid, item, ev } = await seed();
    await ev('restock', 100, daysAgo(200));
    await ev('consume', 6, daysAgo(20));
    await ev('auto_deduct', 9, daysAgo(10));
    await ev('adjust', -50, daysAgo(5));
    await ev('consume', 99, daysAgo(40)); // outside 30d
    const [r] = await consumptionRates(ctx.prisma, hid, '30d', { itemId: item.id, now: NOW });
    expect(r).toMatchObject({ itemId: item.id, window: '30d', days: 30 });
    expect(r!.avgPerDay).toBeCloseTo(15 / 30, 4);
  });

  it('young items divide by their age, floored at 1 day', async () => {
    const { hid, item, ev } = await seed();
    await ev('restock', 10, daysAgo(10));
    await ev('consume', 5, daysAgo(2));
    const [r] = await consumptionRates(ctx.prisma, hid, '90d', { itemId: item.id, now: NOW });
    expect(r!.days).toBeCloseTo(10, 5);
    expect(r!.avgPerDay).toBeCloseTo(0.5, 4);
  });

  it('an item with no usage reports zero', async () => {
    const { hid, item } = await seed();
    expect(await consumptionRates(ctx.prisma, hid, '30d', { itemId: item.id, now: NOW }))
      .toEqual([{ itemId: item.id, window: '30d', avgPerDay: 0, days: 30 }]);
  });

  it('route rejects windows outside the enum', async () => {
    const { u, hid, item } = await seed();
    const base = `/api/households/${hid}`;
    expect((await ctx.call(u, 'GET', `${base}/items/${item.id}/consumption-rate?window=7d`)).status).toBe(400);
    expect((await ctx.call(u, 'GET', `${base}/items/${item.id}/consumption-rate?window=60d`)).status).toBe(200);
    expect((await ctx.call(u, 'GET', `${base}/items/consumption-rates?window=30d`)).status).toBe(200);
    expect((await ctx.call(u, 'GET', `${base}/items/consumption-rates`)).status).toBe(400);
  });
});
