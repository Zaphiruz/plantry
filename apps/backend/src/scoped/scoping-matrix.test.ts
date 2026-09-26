import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

const PREFIX = '/api/households/:hid';

/** Valid bodies so that validation passes and the 404 must come from scoping. `A_ITEM` is replaced with an item in the caller's own household. */
const BODIES: Record<string, unknown> = {
  'PATCH /': { name: 'x' },
  'PATCH /members/:sub': { role: 'member' },
  'POST /stores': { name: 'x' },
  'PATCH /stores/:id': { name: 'x' },
  'POST /units': { name: 'x' },
  'PATCH /units/:id': { name: 'x' },
  'POST /items': { name: 'x', unitId: 'EACH' },
  'PATCH /items/:id': { name: 'x' },
  'POST /items/:targetId/consolidate': { sourceId: 'A_ITEM' },
  'POST /groups': { name: 'x' },
  'PATCH /groups/:id': { name: 'x' },
  'POST /inventory/:itemId/restock': { quantity: 1 },
  'POST /inventory/:itemId/consume': { quantity: 1 },
  'POST /inventory/:itemId/adjust': { newCount: 1 },
  'POST /shopping-list-items': { name: 'x' },
  'PATCH /shopping-list-items/:id': { checkedOff: true },
  'POST /shopping-list/items/:itemId/purchase': {},
  'POST /items/:id/photo/upload-url': { mimeType: 'image/jpeg', sizeBytes: 1000, thumbSizeBytes: 100 },
  'POST /items/:id/photo/finalize': { key: 'h/x/items/y/z.jpg' },
};
const QUERY: Record<string, string> = {
  'GET /items/consumption-rates': '?window=30d',
  'GET /items/:id/consumption-rate': '?window=30d',
};

describe('scoping matrix', () => {
  it('every scoped route 404s for non-members and for foreign resource ids', async () => {
    const caller = await ctx.user({ admin: true }); const bOwner = await ctx.user(); const bMember = await ctx.user();
    const A = await ctx.household(caller, 'A'); const B = await ctx.household(bOwner, 'B');
    await ctx.addMember(B, bMember);
    const aItem = await ctx.item(A);
    const each = await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });

    const bItem = await ctx.item(B, { count: 5, archived: false });
    const bStore = await ctx.prisma.store.create({ data: { householdId: B, name: 's' } });
    const bUnit = await ctx.prisma.unit.create({ data: { householdId: B, name: 'u' } });
    const bRow = await ctx.prisma.shoppingListItem.create({ data: { householdId: B, name: 'r' } });
    const bEvent = await ctx.prisma.inventoryEvent.findFirstOrThrow({ where: { itemId: bItem.id } });
    const bGroup = await ctx.group(B);

    const foreignId = (suffix: string, param: string): string => {
      if (param === 'sub') return bMember.sub;
      if (param === 'eventId') return bEvent.id;
      if (param === 'itemId' || param === 'targetId') return bItem.id;
      if (suffix.startsWith('/stores')) return bStore.id;
      if (suffix.startsWith('/units')) return bUnit.id;
      if (suffix.startsWith('/shopping-list-items')) return bRow.id;
      if (suffix.startsWith('/groups')) return bGroup.id;
      return bItem.id; // /items/:id...
    };

    const scoped = ctx.app.routeTable.filter((r) => r.url.startsWith(PREFIX));
    expect(scoped.length).toBeGreaterThan(30);

    const failures: string[] = [];
    for (const r of scoped) {
      let suffix = r.url.slice(PREFIX.length) || '/';
      if (suffix.length > 1 && suffix.endsWith('/')) suffix = suffix.slice(0, -1);
      const key = `${r.method} ${suffix}`;
      const params = [...suffix.matchAll(/:(\w+)/g)].map((m) => m[1]!);
      const needsBody = ['POST', 'PATCH', 'PUT'].includes(r.method) && !/\/(archive|unarchive|invites)$/.test(suffix);
      if (needsBody && !(key in BODIES)) { failures.push(`${key}: add a body to BODIES`); continue; }
      const body = JSON.parse(JSON.stringify(BODIES[key] ?? null).replace('A_ITEM', aItem.id).replace('EACH', each.id));
      const path = params.reduce((p, name) => p.replace(`:${name}`, foreignId(suffix, name)), suffix === '/' ? '' : suffix);
      const send = (hid: string) => ctx.call(caller, r.method, `/api/households/${hid}${path}${QUERY[key] ?? ''}`, body ?? undefined);

      const nonMember = await send(B);
      if (nonMember.status !== 404) failures.push(`${key} as non-member → ${nonMember.status}`);
      if (params.length > 0) {
        const foreign = await send(A);
        if (foreign.status !== 404) failures.push(`${key} with foreign id → ${foreign.status}`);
      }
    }
    expect(failures).toEqual([]);

    // Nothing in B changed.
    expect(Number((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: bItem.id } })).currentCount)).toBe(5);
    expect(await ctx.prisma.householdMember.count({ where: { householdId: B } })).toBe(2);
  });

  it('membership check is case-insensitive on the household id', async () => {
    const owner = await ctx.user(); const m = await ctx.user();
    const hid = await ctx.household(owner); await ctx.addMember(hid, m);
    const r = await ctx.call(m, 'GET', `/api/households/${hid.toUpperCase()}/members`);
    expect(r.status).toBe(200);
  });
});
