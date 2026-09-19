import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';
import { consolidate } from './items.js';
import { signedDelta } from './inventory.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

describe('consolidate', () => {
  it('moves history, sums counts, inherits barcode, re-points list rows, archives source, audits', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const target = await ctx.item(hid, { name: 'Black beans', count: 2, min: 1 });
    const source = await ctx.item(hid, { name: 'Beans (black)', count: 3, min: 5, barcode: '555' });
    await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: source.id });

    const r = await ctx.call(u, 'POST', `${base}/items/${target.id}/consolidate`, { sourceId: source.id, keepMinStockFrom: 'source' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: target.id, currentCount: 5, minStock: 5, barcode: '555' });
    expect(r.body.data.nextTripRowId).not.toBeNull();

    const src = await ctx.prisma.item.findUniqueOrThrow({ where: { id: source.id }, include: { inventory: true } });
    expect(src.archivedAt).not.toBeNull();
    expect(src.barcode).toBeNull();
    expect(Number(src.inventory!.currentCount)).toBe(0);
    expect(await ctx.prisma.inventoryEvent.count({ where: { itemId: source.id } })).toBe(0);
    const events = await ctx.prisma.inventoryEvent.findMany({ where: { itemId: target.id } });
    expect(events.reduce((a, e) => a + signedDelta(e.eventType, Number(e.quantity)), 0)).toBe(5);
    expect(await ctx.prisma.itemMerge.count({ where: { sourceId: source.id, targetId: target.id } })).toBe(1);
  });

  it('rejects self-merge and archived participants', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const a = await ctx.item(hid); const gone = await ctx.item(hid, { archived: true });
    expect((await ctx.call(u, 'POST', `${base}/items/${a.id}/consolidate`, { sourceId: a.id })).status).toBe(400);
    expect((await ctx.call(u, 'POST', `${base}/items/${a.id}/consolidate`, { sourceId: gone.id })).status).toBe(404);
  });

  it('is atomic: a failure at the last step leaves everything untouched', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const target = await ctx.item(hid, { count: 2 }); const source = await ctx.item(hid, { count: 3, barcode: '777' });
    // 'ghost' violates the item_merges.merged_by FK — the final statement of the transaction.
    await expect(consolidate(ctx.prisma, { hid, targetId: target.id, sourceId: source.id, keepMinStockFrom: 'target', userSub: 'ghost' }))
      .rejects.toThrow();
    const src = await ctx.prisma.item.findUniqueOrThrow({ where: { id: source.id }, include: { inventory: true } });
    expect(src.archivedAt).toBeNull();
    expect(src.barcode).toBe('777');
    expect(Number(src.inventory!.currentCount)).toBe(3);
    expect(await ctx.prisma.inventoryEvent.count({ where: { itemId: source.id } })).toBe(1);
  });
});
