import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);
beforeEach(() => { ctx.push.sent = []; ctx.push.deliverCount = 1; });

import { digestBody, runLowStockDigest } from './low-stock.js';

const NOW = new Date('2026-09-10T06:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const notified = async (id: string) => (await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: id } })).lastNotifiedAt;

describe('digestBody', () => {
  it('formats counts and overflow', () => {
    expect(digestBody(['Cat food'])).toBe('1 item low — Cat food');
    expect(digestBody(['A', 'B'])).toBe('2 items low — A, B');
    expect(digestBody(['A', 'B', 'C', 'D'])).toBe('4 items low — A, B, +2');
  });
});

describe('low-stock digest', () => {
  it('sends one digest per household to all members and stamps last_notified_at', async () => {
    const o = await ctx.user(); const m = await ctx.user();
    const hid = await ctx.household(o, 'Casa'); await ctx.addMember(hid, m);
    const a = await ctx.item(hid, { name: 'Cat food', count: 1, min: 2 });
    const b = await ctx.item(hid, { name: 'Filters', count: 0, min: 0 });
    await ctx.item(hid, { name: 'Fine', count: 9, min: 1 });
    const r = await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect(r).toEqual({ households: 1, items: 2 });
    expect(ctx.push.sent).toEqual([{
      userSubs: [o.sub, m.sub].sort(),
      payload: { title: 'Casa', body: '2 items low — Cat food, Filters', url: `/h/${hid}/shopping` },
    }]);
    expect((await notified(a.id))!.toISOString()).toBe(NOW.toISOString());
    expect(await notified(b.id)).not.toBeNull();
  });

  it('honours per-item renotify_after_days', async () => {
    const o = await ctx.user(); const hid = await ctx.household(o);
    const daily = await ctx.item(hid, { name: 'Daily', count: 0, min: 1 });
    const weekly = await ctx.item(hid, { name: 'Weekly', count: 0, min: 1 });
    await ctx.prisma.item.update({ where: { id: daily.id }, data: { renotifyAfterDays: 1 } });
    await ctx.prisma.inventory.updateMany({ where: { itemId: { in: [daily.id, weekly.id] } }, data: { lastNotifiedAt: daysAgo(2) } });
    await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect(ctx.push.sent[0]!.payload.body).toBe('1 item low — Daily');
    expect((await notified(weekly.id))!.toISOString()).toBe(daysAgo(2).toISOString());
  });

  it('does not stamp when nothing could be delivered, or when push is off', async () => {
    const o = await ctx.user(); const hid = await ctx.household(o);
    const a = await ctx.item(hid, { count: 0, min: 1 });
    ctx.push.deliverCount = 0;
    await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect(await notified(a.id)).toBeNull();
    await runLowStockDigest(ctx.prisma, undefined, NOW);
    expect(await notified(a.id)).toBeNull();
  });
});
