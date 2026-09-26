import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);
beforeEach(() => { ctx.push.sent = []; ctx.push.deliverCount = 1; ctx.push.failForTitle = null; });

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
    expect(r).toEqual({ households: 1, items: 2, failed: 0 });
    expect(ctx.push.sent).toEqual([{
      userSubs: [o.sub, m.sub].sort(),
      payload: { title: 'Casa', body: '2 items low — Cat food, Filters', url: `/h/${hid}/shopping` },
    }]);
    expect((await notified(a.id))!.toISOString()).toBe(NOW.toISOString());
    expect(await notified(b.id)).not.toBeNull();
  });

  it('excludes items with tracking off from the digest count and re-remind window', async () => {
    const o = await ctx.user(); const hid = await ctx.household(o, 'Casa');
    const quiet = await ctx.item(hid, { name: 'Quiet', count: 0, min: 1, trackLow: false });
    const loud = await ctx.item(hid, { name: 'Loud', count: 0, min: 1 });
    const r = await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect(r).toEqual({ households: 1, items: 1, failed: 0 });
    expect(ctx.push.sent[0]!.payload.body).toBe('1 item low — Loud');
    expect(await notified(quiet.id)).toBeNull();
    expect(await notified(loud.id)).not.toBeNull();
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

  it('includes one line per low group, with cadence and last_notified_at like items', async () => {
    const o = await ctx.user(); const hid = await ctx.household(o, 'Casa');
    const group = await ctx.group(hid, { name: 'Cat treats', minStock: 3 });
    await ctx.item(hid, { name: 'Beef', count: 1, groupId: group.id });
    await ctx.item(hid, { name: 'Chicken', count: 1, groupId: group.id });
    await ctx.item(hid, { name: 'Salmon', count: 1, groupId: group.id });
    const r = await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect(r).toEqual({ households: 1, items: 1, failed: 0 });
    expect(ctx.push.sent[0]!.payload.body).toBe('1 item low — Cat treats (all 3 low)');
    expect((await ctx.prisma.itemGroup.findUniqueOrThrow({ where: { id: group.id } })).lastNotifiedAt!.toISOString()).toBe(NOW.toISOString());
  });

  it('honours a group renotify_after_days cadence independent of items', async () => {
    const o = await ctx.user(); const hid = await ctx.household(o);
    const group = await ctx.group(hid, { name: 'Treats', minStock: 5, renotifyAfterDays: 1 });
    await ctx.item(hid, { name: 'Beef', count: 0, groupId: group.id });
    await ctx.prisma.itemGroup.update({ where: { id: group.id }, data: { lastNotifiedAt: daysAgo(2) } });
    await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect((await ctx.prisma.itemGroup.findUniqueOrThrow({ where: { id: group.id } })).lastNotifiedAt!.toISOString()).toBe(NOW.toISOString());

    const weekly = await ctx.group(hid, { name: 'Weekly', minStock: 5 });
    await ctx.item(hid, { name: 'Salmon', count: 0, groupId: weekly.id });
    await ctx.prisma.itemGroup.update({ where: { id: weekly.id }, data: { lastNotifiedAt: daysAgo(2) } });
    await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect((await ctx.prisma.itemGroup.findUniqueOrThrow({ where: { id: weekly.id } })).lastNotifiedAt!.toISOString()).toBe(daysAgo(2).toISOString());
  });

  it('a group with no low members is not in the digest', async () => {
    const o = await ctx.user(); const hid = await ctx.household(o);
    const group = await ctx.group(hid, { name: 'Fine', minStock: 1 });
    await ctx.item(hid, { name: 'Beef', count: 9, groupId: group.id });
    const r = await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect(r).toEqual({ households: 0, items: 0, failed: 0 });
  });

  it('isolates a per-household push failure so other households still get digested', async () => {
    const oa = await ctx.user(); const hidA = await ctx.household(oa, 'Alpha');
    const itemA = await ctx.item(hidA, { count: 0, min: 1 });
    const ob = await ctx.user(); const hidB = await ctx.household(ob, 'Beta');
    const itemB = await ctx.item(hidB, { count: 0, min: 1 });
    ctx.push.failForTitle = 'Alpha';
    const log = vi.fn();
    const r = await runLowStockDigest(ctx.prisma, ctx.push, NOW, log);
    expect(r).toEqual({ households: 1, items: 1, failed: 1 });
    expect(await notified(itemB.id)).not.toBeNull();
    expect(await notified(itemA.id)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });
});
