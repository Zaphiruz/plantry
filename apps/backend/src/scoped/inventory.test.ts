import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

describe('inventory routes', () => {
  it('restock / consume (default 1) / adjust', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { count: 5, min: 2 });
    expect((await ctx.call(u, 'POST', `${base}/inventory/${item.id}/consume`, {})).body.data.item.currentCount).toBe(4);
    expect((await ctx.call(u, 'POST', `${base}/inventory/${item.id}/consume`, { quantity: 2.5 })).body.data.item.currentCount).toBe(1.5);
    expect((await ctx.call(u, 'POST', `${base}/inventory/${item.id}/restock`, { quantity: 10 })).body.data.item.currentCount).toBe(11.5);
    const adj = await ctx.call(u, 'POST', `${base}/inventory/${item.id}/adjust`, { newCount: 7 });
    expect(adj.body.data.item.currentCount).toBe(7);
    const last = await ctx.prisma.inventoryEvent.findUniqueOrThrow({ where: { id: adj.body.data.eventId } });
    expect([last.eventType, Number(last.quantity)]).toEqual(['adjust', -4.5]);
    expect((await ctx.call(u, 'POST', `${base}/inventory/${item.id}/restock`, { quantity: 0 })).status).toBe(400);
  });

  it('adjust to the same count writes no event', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.item(hid, { count: 3 });
    const r = await ctx.call(u, 'POST', `/api/households/${hid}/inventory/${item.id}/adjust`, { newCount: 3 });
    expect(r.body.data.eventId).toBeNull();
  });

  it('/inventory/low lists count <= min, excluding archived', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    await ctx.item(hid, { name: 'ok', count: 5, min: 2 });
    await ctx.item(hid, { name: 'edge', count: 2, min: 2 });
    await ctx.item(hid, { name: 'neg', count: -1, min: 0 });
    await ctx.item(hid, { name: 'gone', count: 0, min: 5, archived: true });
    const low = (await ctx.call(u, 'GET', `${base}/inventory/low`)).body.data.map((i: any) => i.name);
    expect(low.sort()).toEqual(['edge', 'neg']);
    expect((await ctx.call(u, 'GET', `${base}/inventory`)).body.data).toHaveLength(3);
  });

  it('event history is newest-first with user names and paginates', async () => {
    const u = await ctx.user({ name: 'Ada' }); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid);
    for (let i = 0; i < 55; i++) await ctx.call(u, 'POST', `${base}/inventory/${item.id}/restock`, { quantity: 1 });
    const p1 = (await ctx.call(u, 'GET', `${base}/inventory/${item.id}/events`)).body.data;
    expect(p1.events).toHaveLength(50);
    expect(p1.events[0].userName).toBe('Ada');
    const p2 = (await ctx.call(u, 'GET', `${base}/inventory/${item.id}/events?cursor=${p1.nextCursor}`)).body.data;
    expect(p2.events).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();
  });

  it('undo: own event only, within 5 minutes, never auto_deduct', async () => {
    const u = await ctx.user(); const other = await ctx.user();
    const hid = await ctx.household(u); await ctx.addMember(hid, other);
    const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { count: 5 });
    const ev = (await ctx.call(u, 'POST', `${base}/inventory/${item.id}/consume`, {})).body.data.eventId;
    expect((await ctx.call(other, 'DELETE', `${base}/inventory/events/${ev}`)).status).toBe(403);
    expect((await ctx.call(u, 'DELETE', `${base}/inventory/events/${ev}`)).status).toBe(204);
    expect(Number((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } })).currentCount)).toBe(5);

    const old = (await ctx.call(u, 'POST', `${base}/inventory/${item.id}/consume`, {})).body.data.eventId;
    await ctx.prisma.inventoryEvent.update({ where: { id: old }, data: { createdAt: new Date(Date.now() - 6 * 60_000) } });
    const late = await ctx.call(u, 'DELETE', `${base}/inventory/events/${old}`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('undo_expired');
  });
});
