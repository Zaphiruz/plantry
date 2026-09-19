import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

import { runAutoDeduct } from './auto-deduct.js';

const DAY = 86_400_000;
const T0 = new Date('2026-09-01T10:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);

async function autoItem(hid: string, qty: number, period: number, anchor: Date | null, extra: { paused?: boolean; archived?: boolean; count?: number } = {}) {
  const item = await ctx.item(hid, { count: extra.count ?? 100, archived: extra.archived });
  await ctx.prisma.item.update({ where: { id: item.id }, data: { autoDeductQty: qty, autoDeductPeriodDays: period, autoDeductPaused: extra.paused ?? false } });
  await ctx.prisma.inventory.update({ where: { itemId: item.id }, data: { lastAutoDeductAt: anchor } });
  return item;
}
const inv = (itemId: string) => ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId } });

describe('auto-deduct', () => {
  it('catches up whole periods and carries the remainder', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await autoItem(hid, 2, 1, T0);
    await runAutoDeduct(ctx.prisma, at(3.5));                     // 3 periods → −6, anchor = T0+3d
    let i = await inv(item.id);
    expect(Number(i.currentCount)).toBe(94);
    expect(i.lastAutoDeductAt!.toISOString()).toBe(at(3).toISOString());
    await runAutoDeduct(ctx.prisma, at(3.9));                     // 0.9 since anchor → nothing
    expect(Number((await inv(item.id)).currentCount)).toBe(94);
    await runAutoDeduct(ctx.prisma, at(4.1));                     // 1.1 → −2, anchor = T0+4d
    i = await inv(item.id);
    expect(Number(i.currentCount)).toBe(92);
    expect(i.lastAutoDeductAt!.toISOString()).toBe(at(4).toISOString());
    const evs = await ctx.prisma.inventoryEvent.findMany({ where: { itemId: item.id, eventType: 'auto_deduct' }, orderBy: { createdAt: 'asc' } });
    expect(evs.map((e) => [Number(e.quantity), e.userSub])).toEqual([[6, null], [2, null]]);
  });

  it('supports slow rates: 1 per 90 days stays whole until day 90', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await autoItem(hid, 1, 90, T0, { count: 1 });
    await runAutoDeduct(ctx.prisma, at(89.9));
    expect(Number((await inv(item.id)).currentCount)).toBe(1);
    await runAutoDeduct(ctx.prisma, at(91));
    const i = await inv(item.id);
    expect(Number(i.currentCount)).toBe(0);
    expect(i.lastAutoDeductAt!.toISOString()).toBe(at(90).toISOString());
  });

  it('skips paused, archived, and disabled items; goes negative happily', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const paused = await autoItem(hid, 5, 1, T0, { paused: true });
    const archived = await autoItem(hid, 5, 1, T0, { archived: true });
    const plain = await ctx.item(hid, { count: 100 });
    const neg = await autoItem(hid, 5, 1, T0, { count: 3 });
    const r = await runAutoDeduct(ctx.prisma, at(2));
    expect(r).toEqual({ deducted: 1, failed: 0 });
    for (const it of [paused, archived, plain]) expect(Number((await inv(it.id)).currentCount)).toBe(100);
    expect(Number((await inv(neg.id)).currentCount)).toBe(-7);
  });

  it('a missing anchor is initialised to now without deducting', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await autoItem(hid, 5, 1, null);
    await runAutoDeduct(ctx.prisma, at(10));
    const i = await inv(item.id);
    expect(Number(i.currentCount)).toBe(100);
    expect(i.lastAutoDeductAt!.toISOString()).toBe(at(10).toISOString());
  });
});
