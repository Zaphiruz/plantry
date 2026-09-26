import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

describe('shopping list', () => {
  it('merges derived + linked-manual (deduped) + free-text, grouped by store with Any store last', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const costco = (await ctx.call(u, 'POST', `${base}/stores`, { name: 'Costco' })).body.data.id;
    const aldi = (await ctx.call(u, 'POST', `${base}/stores`, { name: 'Aldi' })).body.data.id;
    const lowAndManual = await ctx.item(hid, { name: 'Cat food', count: 1, min: 2, storeId: costco, defaultRestockQty: 12 });
    const manualOnly = await ctx.item(hid, { name: 'Coffee', count: 9, min: 1, storeId: aldi });
    await ctx.item(hid, { name: 'Plenty', count: 9, min: 1, storeId: aldi });
    await ctx.item(hid, { name: 'No store low', count: 0, min: 1 });

    expect((await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: lowAndManual.id })).status).toBe(200);
    expect((await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: manualOnly.id, quantity: 3 })).status).toBe(200);
    const dup = await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: manualOnly.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_on_list');
    await ctx.call(u, 'POST', `${base}/shopping-list-items`, { name: 'Birthday candles', storeId: aldi });

    const groups = (await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups;
    expect(groups.map((g: any) => g.store?.name ?? null)).toEqual(['Aldi', 'Costco', null]);
    expect(groups[0].entries.map((e: any) => [e.kind, e.name])).toEqual([['text', 'Birthday candles'], ['item', 'Coffee']]);
    expect(groups[0].entries[1]).toMatchObject({ low: false, manual: true, quantity: 3 });
    expect(groups[1].entries).toHaveLength(1);
    expect(groups[1].entries[0]).toMatchObject({ name: 'Cat food', low: true, manual: true, quantity: 12 });
    expect(groups[2].entries[0]).toMatchObject({ name: 'No store low', low: true, manual: false, rowId: null });
  });

  it('an untracked low item is absent from the derived list, but shows raw low:true when added manually', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const quiet = await ctx.item(hid, { name: 'Quiet', count: 0, min: 1, trackLow: false });

    const before = (await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups;
    expect(before).toEqual([]);

    expect((await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: quiet.id })).status).toBe(200);
    const groups = (await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups;
    expect(groups[0].entries[0]).toMatchObject({ name: 'Quiet', low: true, manual: true });
  });

  it('purchase restocks default qty, stamps last_checked_off_at, removes the manual row, and is undoable', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { count: 1, min: 2, defaultRestockQty: 12 });
    await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: item.id });
    const r = await ctx.call(u, 'POST', `${base}/shopping-list/items/${item.id}/purchase`);
    expect(r.status).toBe(200);
    const inv = await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } });
    expect(Number(inv.currentCount)).toBe(13);
    expect(inv.lastCheckedOffAt).not.toBeNull();
    expect(await ctx.prisma.shoppingListItem.count()).toBe(0);
    expect((await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups).toEqual([]);
    expect((await ctx.call(u, 'DELETE', `${base}/inventory/events/${r.body.data.eventId}`)).status).toBe(204);
    expect(Number((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } })).currentCount)).toBe(1);
  });

  it('purchase quantity precedence: body > row.quantity > default; still-low items stay listed', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { count: 0, min: 10, defaultRestockQty: 4 });
    await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: item.id, quantity: 3 });
    await ctx.call(u, 'POST', `${base}/shopping-list/items/${item.id}/purchase`);               // row qty 3 → 3
    await ctx.call(u, 'POST', `${base}/shopping-list/items/${item.id}/purchase`, { quantity: 2 }); // body → 5
    await ctx.call(u, 'POST', `${base}/shopping-list/items/${item.id}/purchase`);               // default 4 → 9
    expect(Number((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } })).currentCount)).toBe(9);
    expect((await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups[0].entries[0].low).toBe(true);
  });

  it('a low group renders one entry with members + suggested (most recently restocked, else first by name)', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const group = (await ctx.call(u, 'POST', `${base}/groups`, { name: 'Cat treats', minStock: 3 })).body.data;
    await ctx.item(hid, { name: 'Beef', count: 1, groupId: group.id, defaultRestockQty: 2 });
    const chicken = await ctx.item(hid, { name: 'Chicken', count: 1, groupId: group.id, defaultRestockQty: 5 });
    await ctx.call(u, 'POST', `${base}/inventory/${chicken.id}/restock`, { quantity: 1 }); // most recently restocked

    const groups = (await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups;
    expect(groups).toHaveLength(1);
    const entry = groups[0].entries[0];
    expect(entry.kind).toBe('group');
    expect(entry).toMatchObject({ name: 'Cat treats', total: 3, minStock: 3, suggested: { itemId: chicken.id, quantity: 5 } });
    expect(entry.members.map((m: any) => m.name).sort()).toEqual(['Beef', 'Chicken']);
  });

  it('a group not low is absent; purchasing the suggested member removes the line once total > min', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const group = (await ctx.call(u, 'POST', `${base}/groups`, { name: 'Cat treats', minStock: 2 })).body.data;
    const a = await ctx.item(hid, { name: 'Beef', count: 1, groupId: group.id, defaultRestockQty: 4 });
    await ctx.item(hid, { name: 'Chicken', count: 0, groupId: group.id });

    expect((await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups[0].entries[0].kind).toBe('group');
    const r = await ctx.call(u, 'POST', `${base}/shopping-list/items/${a.id}/purchase`);
    expect(r.status).toBe(200); // reuses the existing purchase route with the suggested member's itemId
    expect((await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups).toEqual([]);
  });

  it('an untracked member never becomes the suggestion and is excluded from the low sum', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const group = (await ctx.call(u, 'POST', `${base}/groups`, { name: 'Cat treats', minStock: 1 })).body.data;
    await ctx.item(hid, { name: 'Beef', count: 0, groupId: group.id, trackLow: false, defaultRestockQty: 99 });
    await ctx.item(hid, { name: 'Chicken', count: 0, groupId: group.id, defaultRestockQty: 3 });
    const entry = (await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups[0].entries[0];
    expect(entry.total).toBe(0);
    expect(entry.suggested.quantity).toBe(3);
  });

  it('free-text rows toggle checked_off and never touch inventory; linked rows cannot be PATCHed', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const row = (await ctx.call(u, 'POST', `${base}/shopping-list-items`, { name: 'Candles' })).body.data;
    const on = await ctx.call(u, 'PATCH', `${base}/shopping-list-items/${row.id}`, { checkedOff: true });
    expect(on.body.data.checkedOff).toBe(true);
    expect((await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups[0].entries[0].checkedOff).toBe(true);
    const item = await ctx.item(hid);
    const linked = (await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: item.id })).body.data;
    expect((await ctx.call(u, 'PATCH', `${base}/shopping-list-items/${linked.id}`, { checkedOff: true })).status).toBe(400);
    expect((await ctx.call(u, 'DELETE', `${base}/shopping-list-items/${linked.id}`)).status).toBe(204);
  });
});
