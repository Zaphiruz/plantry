import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';
import { runSweeps } from './sweeps.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);
beforeEach(() => ctx.storage.objects.clear());

const NOW = new Date('2026-09-10T06:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('sweeps', () => {
  it('removes expired sessions, stale invites, old checked-off free-text rows, and orphan photos only', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    await ctx.prisma.session.create({ data: { idHash: 'dead', userSub: u.sub, data: {}, expiresAt: hoursAgo(1) } });
    await ctx.prisma.householdInvite.createMany({ data: [
      { tokenHash: 'fresh', householdId: hid, createdBy: u.sub, expiresAt: new Date(NOW.getTime() + 1000) },
      { tokenHash: 'expired', householdId: hid, createdBy: u.sub, expiresAt: hoursAgo(1) },
    ] });
    await ctx.prisma.shoppingListItem.createMany({ data: [
      { householdId: hid, name: 'old checked', checkedOff: true, checkedOffAt: hoursAgo(25) },
      { householdId: hid, name: 'new checked', checkedOff: true, checkedOffAt: hoursAgo(2) },
      { householdId: hid, name: 'open' },
    ] });
    const item = await ctx.item(hid);
    const live = `h/${hid}/items/${item.id}/11111111-1111-1111-1111-111111111111.jpg`;
    await ctx.prisma.item.update({ where: { id: item.id }, data: { imageRef: live } });
    const liveThumb = live.replace('.jpg', '-thumb.jpg');
    ctx.storage.put(live, hoursAgo(100)); ctx.storage.put(liveThumb, hoursAgo(100));
    ctx.storage.put('h/x/items/y/old-orphan.jpg', hoursAgo(25));
    ctx.storage.put('h/x/items/y/in-flight.jpg', hoursAgo(1));

    await runSweeps(ctx.prisma, ctx.storage, NOW);

    expect(await ctx.prisma.session.count({ where: { idHash: 'dead' } })).toBe(0);
    expect(await ctx.prisma.session.count()).toBe(1); // u's live session
    expect((await ctx.prisma.householdInvite.findMany()).map((i) => i.tokenHash)).toEqual(['fresh']);
    expect((await ctx.prisma.shoppingListItem.findMany({ orderBy: { name: 'asc' } })).map((r) => r.name)).toEqual(['new checked', 'open']);
    expect([...ctx.storage.objects.keys()].sort()).toEqual(['h/x/items/y/in-flight.jpg', live, liveThumb].sort());
  });
});
