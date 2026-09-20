import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

describe('stores', () => {
  it('CRUD, and delete nulls item references', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const base = `/api/households/${hid}`;
    const created = await ctx.call(u, 'POST', `${base}/stores`, { name: 'Costco', notes: 'bulk' });
    expect(created.status).toBe(200);
    const id = created.body.data.id;
    expect((await ctx.call(u, 'PATCH', `${base}/stores/${id}`, { name: 'Costco West' })).body.data.name).toBe('Costco West');
    expect((await ctx.call(u, 'GET', `${base}/stores`)).body.data).toHaveLength(1);

    const each = await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });
    const item = await ctx.prisma.item.create({
      data: { householdId: hid, name: 'Rice', unitId: each.id, preferredStoreId: id, inventory: { create: {} } },
    });
    expect((await ctx.call(u, 'DELETE', `${base}/stores/${id}`)).status).toBe(204);
    expect((await ctx.prisma.item.findUniqueOrThrow({ where: { id: item.id } })).preferredStoreId).toBeNull();
  });
});

describe('units', () => {
  it('migrated global units have the specified steps', async () => {
    const steps = await ctx.prisma.unit.findMany({
      where: { householdId: null }, select: { name: true, step: true }, orderBy: { name: 'asc' },
    });
    const byName = Object.fromEntries(steps.map((u) => [u.name, Number(u.step)]));
    expect(byName.lb).toBe(0.1);
    expect(byName.kg).toBe(0.1);
    expect(byName.l).toBe(0.1);
    expect(byName.gallon).toBe(0.25);
    for (const name of ['each', 'can', 'bottle', 'box', 'bag', 'roll', 'oz', 'g', 'ml']) {
      expect(byName[name]).toBe(1);
    }
  });

  it('create with a custom step is returned and persisted', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const res = await ctx.call(u, 'POST', `/api/households/${hid}/units`, { name: 'case', step: 8 });
    expect(res.status).toBe(200);
    expect(res.body.data.step).toBe(8);
    const row = await ctx.prisma.unit.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(Number(row.step)).toBe(8);
  });

  it('create defaults step to 1 when omitted', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const res = await ctx.call(u, 'POST', `/api/households/${hid}/units`, { name: 'sleeve' });
    expect(res.body.data.step).toBe(1);
  });

  it('PATCH updates step', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const id = (await ctx.call(u, 'POST', `/api/households/${hid}/units`, { name: 'sleeve' })).body.data.id;
    const res = await ctx.call(u, 'PATCH', `/api/households/${hid}/units/${id}`, { step: 5 });
    expect(res.body.data.step).toBe(5);
  });

  it('rejects step 0.001', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const res = await ctx.call(u, 'POST', `/api/households/${hid}/units`, { name: 'sleeve', step: 0.001 });
    expect(res.status).toBe(400);
  });

  it('lists globals + own, never another household’s', async () => {
    const a = await ctx.user(); const b = await ctx.user();
    const ha = await ctx.household(a); const hb = await ctx.household(b);
    await ctx.call(b, 'POST', `/api/households/${hb}/units`, { name: 'crate' });
    await ctx.call(a, 'POST', `/api/households/${ha}/units`, { name: 'sleeve', pluralName: 'sleeves' });
    const list = (await ctx.call(a, 'GET', `/api/households/${ha}/units`)).body.data;
    expect(list).toHaveLength(14);
    expect(list.filter((x: any) => !x.global).map((x: any) => x.name)).toEqual(['sleeve']);
  });

  it('globals are read-only', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const each = await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });
    expect((await ctx.call(u, 'PATCH', `/api/households/${hid}/units/${each.id}`, { name: 'x' })).status).toBe(403);
    expect((await ctx.call(u, 'DELETE', `/api/households/${hid}/units/${each.id}`)).status).toBe(403);
  });

  it('delete is blocked by active items (409 + count) and re-points archived ones', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const base = `/api/households/${hid}`;
    const unitId = (await ctx.call(u, 'POST', `${base}/units`, { name: 'sleeve' })).body.data.id;
    const active = await ctx.prisma.item.create({ data: { householdId: hid, name: 'Cups', unitId, inventory: { create: {} } } });
    const archived = await ctx.prisma.item.create({
      data: { householdId: hid, name: 'Old', unitId, archivedAt: new Date(), inventory: { create: {} } },
    });
    const blocked = await ctx.call(u, 'DELETE', `${base}/units/${unitId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: 'unit_in_use', details: { itemCount: 1 } });

    await ctx.prisma.item.update({ where: { id: active.id }, data: { archivedAt: new Date() } });
    expect((await ctx.call(u, 'DELETE', `${base}/units/${unitId}`)).status).toBe(204);
    const each = await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });
    expect((await ctx.prisma.item.findUniqueOrThrow({ where: { id: archived.id } })).unitId).toBe(each.id);
  });
});
