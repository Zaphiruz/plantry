import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

describe('groups', () => {
  it('creates with defaults and lists', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const r = await ctx.call(u, 'POST', `${base}/groups`, { name: 'Cat treats' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ name: 'Cat treats', minStock: 0, renotifyAfterDays: 7, preferredStoreId: null, memberIds: [], total: 0, low: false });
    expect((await ctx.call(u, 'GET', `${base}/groups`)).body.data).toHaveLength(1);
  });

  it('rejects an unknown preferred store', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const r = await ctx.call(u, 'POST', `${base}/groups`, { name: 'x', preferredStoreId: '00000000-0000-0000-0000-000000000000' });
    expect(r.status).toBe(400);
  });

  it('is low when the sum of active tracked members <= min_stock; untracked members excluded from the sum', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const group = (await ctx.call(u, 'POST', `${base}/groups`, { name: 'Cat treats', minStock: 3 })).body.data;
    await ctx.item(hid, { name: 'Salmon', count: 1, groupId: group.id });
    await ctx.item(hid, { name: 'Chicken', count: 1, groupId: group.id });
    await ctx.item(hid, { name: 'Beef (untracked)', count: 99, groupId: group.id, trackLow: false });
    const g = (await ctx.call(u, 'GET', `${base}/groups`)).body.data[0];
    expect(g).toMatchObject({ total: 2, low: true });
    expect(g.memberIds).toHaveLength(3);
  });

  it('adjusting a member\'s count so the group recovers clears the group\'s last_notified_at', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const group = (await ctx.call(u, 'POST', `${base}/groups`, { name: 'Cat treats', minStock: 2 })).body.data;
    const a = await ctx.item(hid, { name: 'Salmon', count: 1, groupId: group.id });
    await ctx.prisma.itemGroup.update({ where: { id: group.id }, data: { lastNotifiedAt: new Date() } });

    const r = await ctx.call(u, 'POST', `${base}/inventory/${a.id}/adjust`, { newCount: 5 });
    expect(r.status).toBe(200);
    expect((await ctx.prisma.itemGroup.findUniqueOrThrow({ where: { id: group.id } })).lastNotifiedAt).toBeNull();
  });

  it('is not low when one member alone covers the minimum', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const group = (await ctx.call(u, 'POST', `${base}/groups`, { name: 'Cat treats', minStock: 2 })).body.data;
    await ctx.item(hid, { name: 'Salmon', count: 10, groupId: group.id });
    await ctx.item(hid, { name: 'Chicken', count: 0, groupId: group.id });
    const g = (await ctx.call(u, 'GET', `${base}/groups`)).body.data[0];
    expect(g).toMatchObject({ total: 10, low: false });
  });

  it('a group with zero active members is never low, even at min_stock 0', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    await ctx.call(u, 'POST', `${base}/groups`, { name: 'Empty' });
    const g = (await ctx.call(u, 'GET', `${base}/groups`)).body.data[0];
    expect(g).toMatchObject({ total: 0, low: false });
  });

  it('an item joining a group is excluded from item-level low/nagging', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const group = (await ctx.call(u, 'POST', `${base}/groups`, { name: 'Cat treats', minStock: 5 })).body.data;
    const item = await ctx.item(hid, { name: 'Salmon', count: 1, min: 3, groupId: group.id });
    const dto = (await ctx.call(u, 'GET', `${base}/items/${item.id}`)).body.data;
    expect(dto).toMatchObject({ low: true, nagging: false, groupId: group.id }); // own low still shown, but doesn't nag
    const low = (await ctx.call(u, 'GET', `${base}/inventory/low`)).body.data;
    expect(low).toEqual([]);
  });

  it('PATCH updates fields; DELETE sets members group_id to null', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const group = (await ctx.call(u, 'POST', `${base}/groups`, { name: 'Cat treats' })).body.data;
    const item = await ctx.item(hid, { groupId: group.id });
    const patched = await ctx.call(u, 'PATCH', `${base}/groups/${group.id}`, { name: 'Treats', minStock: 4 });
    expect(patched.body.data).toMatchObject({ name: 'Treats', minStock: 4 });
    expect((await ctx.call(u, 'DELETE', `${base}/groups/${group.id}`)).status).toBe(204);
    const reloaded = await ctx.prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(reloaded.groupId).toBeNull();
  });

  it('assigning an item to a group from another household is a 400', async () => {
    const a = await ctx.user(); const b = await ctx.user();
    const ha = await ctx.household(a); const hb = await ctx.household(b);
    const bGroup = (await ctx.call(b, 'POST', `/api/households/${hb}/groups`, { name: 'x' })).body.data;
    const r = await ctx.call(a, 'POST', `/api/households/${ha}/items`, { name: 'X', unitId: (await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } })).id, groupId: bGroup.id });
    expect(r.status).toBe(400);
  });

  it('a group in another household 404s', async () => {
    const a = await ctx.user(); const b = await ctx.user();
    const ha = await ctx.household(a); const hb = await ctx.household(b);
    const bGroup = (await ctx.call(b, 'POST', `/api/households/${hb}/groups`, { name: 'x' })).body.data;
    expect((await ctx.call(a, 'PATCH', `/api/households/${ha}/groups/${bGroup.id}`, { name: 'y' })).status).toBe(404);
    expect((await ctx.call(a, 'DELETE', `/api/households/${ha}/groups/${bGroup.id}`)).status).toBe(404);
  });
});
