import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

const eachId = async () => (await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } })).id;

describe('items', () => {
  it('creates with inventory; initial count is an adjust event', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const r = await ctx.call(u, 'POST', `/api/households/${hid}/items`,
      { name: 'Cat food', unitId: await eachId(), currentCount: 6, minStock: 4, barcode: '0123' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      name: 'Cat food', currentCount: 6, minStock: 4, low: false, defaultRestockQty: 1,
      unit: { name: 'each', global: true }, nextTripRowId: null, imageUrl: null,
    });
    const events = await ctx.prisma.inventoryEvent.findMany({ where: { itemId: r.body.data.id } });
    expect(events.map((e) => [e.eventType, Number(e.quantity)])).toEqual([['adjust', 6]]);
  });

  it('rejects units/stores from another household', async () => {
    const a = await ctx.user(); const b = await ctx.user();
    const ha = await ctx.household(a); const hb = await ctx.household(b);
    const foreignUnit = (await ctx.call(b, 'POST', `/api/households/${hb}/units`, { name: 'crate' })).body.data.id;
    const r = await ctx.call(a, 'POST', `/api/households/${ha}/items`, { name: 'X', unitId: foreignUnit });
    expect(r.status).toBe(400);
  });

  it('barcode is unique among active items; lookup by barcode and q', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    await ctx.item(hid, { name: 'Black beans', barcode: '111' });
    const dup = await ctx.call(u, 'POST', `${base}/items`, { name: 'Other', unitId: await eachId(), barcode: '111' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('barcode_conflict');
    expect((await ctx.call(u, 'GET', `${base}/items?barcode=111`)).body.data).toHaveLength(1);
    expect((await ctx.call(u, 'GET', `${base}/items?q=BEAN`)).body.data).toHaveLength(1);
    expect((await ctx.call(u, 'GET', `${base}/items?barcode=999`)).body.data).toEqual([]);
  });

  it('PATCH edits fields + minStock; enabling/editing/unpausing auto-deduct resets the anchor, restock-unrelated edits do not', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid);
    const anchor = async () => (await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } })).lastAutoDeductAt;
    expect(await anchor()).toBeNull();

    await ctx.call(u, 'PATCH', `${base}/items/${item.id}`, { autoDeductQty: 1, autoDeductPeriodDays: 90, minStock: 1 });
    const a1 = await anchor(); expect(a1).not.toBeNull();

    await ctx.prisma.inventory.update({ where: { itemId: item.id }, data: { lastAutoDeductAt: new Date('2026-01-01') } });
    await ctx.call(u, 'PATCH', `${base}/items/${item.id}`, { name: 'Renamed' });
    expect((await anchor())!.toISOString()).toBe('2026-01-01T00:00:00.000Z');

    await ctx.call(u, 'PATCH', `${base}/items/${item.id}`, { autoDeductPaused: true });
    expect((await anchor())!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    await ctx.call(u, 'PATCH', `${base}/items/${item.id}`, { autoDeductPaused: false });
    expect((await anchor())!.getTime()).toBeGreaterThan(new Date('2026-06-01').getTime());

    await ctx.call(u, 'PATCH', `${base}/items/${item.id}`, { autoDeductQty: null });
    expect(await anchor()).toBeNull();
  });

  it('archive hides from default list and drops next-trip rows; unarchive restores; barcode collision blocks unarchive', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { barcode: '222' });
    await ctx.prisma.shoppingListItem.create({ data: { householdId: hid, itemId: item.id, name: item.name } });
    expect((await ctx.call(u, 'POST', `${base}/items/${item.id}/archive`)).status).toBe(200);
    expect((await ctx.call(u, 'GET', `${base}/items`)).body.data).toHaveLength(0);
    expect((await ctx.call(u, 'GET', `${base}/items?archived=true`)).body.data).toHaveLength(1);
    expect(await ctx.prisma.shoppingListItem.count()).toBe(0);

    await ctx.item(hid, { barcode: '222' });
    expect((await ctx.call(u, 'POST', `${base}/items/${item.id}/unarchive`)).body.error.code).toBe('barcode_conflict');
  });

  it('hard delete: admin only, archived only, cascades', async () => {
    const admin = await ctx.user({ admin: true }); const pleb = await ctx.user();
    const hid = await ctx.household(admin); await ctx.addMember(hid, pleb);
    const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { count: 3 });
    expect((await ctx.call(pleb, 'DELETE', `${base}/items/${item.id}`)).status).toBe(403);
    const early = await ctx.call(admin, 'DELETE', `${base}/items/${item.id}`);
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('archive_first');
    await ctx.call(admin, 'POST', `${base}/items/${item.id}/archive`);
    expect((await ctx.call(admin, 'DELETE', `${base}/items/${item.id}`)).status).toBe(204);
    expect(await ctx.prisma.inventoryEvent.count({ where: { itemId: item.id } })).toBe(0);
  });
});
