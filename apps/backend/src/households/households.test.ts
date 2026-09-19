import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

describe('households', () => {
  it('creator becomes owner and it shows in /me', async () => {
    const u = await ctx.user();
    const r = await ctx.call(u, 'POST', '/api/households', { name: 'Casa' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ name: 'Casa', role: 'owner' });
    const me = await ctx.call(u, 'GET', '/api/me');
    expect(me.body.data.households).toHaveLength(1);
  });

  it('non-members and malformed ids get 404', async () => {
    const owner = await ctx.user(); const stranger = await ctx.user();
    const hid = await ctx.household(owner);
    expect((await ctx.call(stranger, 'GET', `/api/households/${hid}/members`)).status).toBe(404);
    expect((await ctx.call(owner, 'GET', '/api/households/not-a-uuid/members')).status).toBe(404);
    expect((await ctx.call(null, 'GET', `/api/households/${hid}/members`)).status).toBe(401);
  });

  it('lists members with names', async () => {
    const owner = await ctx.user({ name: 'Olive' }); const m = await ctx.user({ name: 'Max' });
    const hid = await ctx.household(owner); await ctx.addMember(hid, m);
    const r = await ctx.call(m, 'GET', `/api/households/${hid}/members`);
    expect(r.body.data.map((x: any) => [x.name, x.role])).toEqual([['Olive', 'owner'], ['Max', 'member']]);
  });

  it('only owners rename, change roles, remove', async () => {
    const owner = await ctx.user(); const m = await ctx.user();
    const hid = await ctx.household(owner); await ctx.addMember(hid, m);
    expect((await ctx.call(m, 'PATCH', `/api/households/${hid}`, { name: 'X' })).status).toBe(403);
    expect((await ctx.call(m, 'PATCH', `/api/households/${hid}/members/${owner.sub}`, { role: 'member' })).status).toBe(403);
    expect((await ctx.call(m, 'DELETE', `/api/households/${hid}/members/${owner.sub}`)).status).toBe(403);
    expect((await ctx.call(owner, 'PATCH', `/api/households/${hid}`, { name: 'X' })).status).toBe(200);
    expect((await ctx.call(owner, 'DELETE', `/api/households/${hid}/members/${m.sub}`)).status).toBe(204);
    expect((await ctx.call(m, 'GET', `/api/households/${hid}/members`)).status).toBe(404);
  });

  it('last owner cannot leave or demote self while others remain', async () => {
    const owner = await ctx.user(); const m = await ctx.user();
    const hid = await ctx.household(owner); await ctx.addMember(hid, m);
    const leave = await ctx.call(owner, 'DELETE', `/api/households/${hid}/members/me`);
    expect(leave.status).toBe(409);
    expect(leave.body.error.code).toBe('last_owner');
    const demote = await ctx.call(owner, 'PATCH', `/api/households/${hid}/members/${owner.sub}`, { role: 'member' });
    expect(demote.body.error.code).toBe('last_owner');
    // promote, then leaving works
    expect((await ctx.call(owner, 'PATCH', `/api/households/${hid}/members/${m.sub}`, { role: 'owner' })).status).toBe(200);
    expect((await ctx.call(owner, 'DELETE', `/api/households/${hid}/members/me`)).status).toBe(204);
  });

  it('last member leaving deletes the household', async () => {
    const owner = await ctx.user();
    const hid = await ctx.household(owner);
    expect((await ctx.call(owner, 'DELETE', `/api/households/${hid}/members/me`)).status).toBe(204);
    expect(await ctx.prisma.household.findUnique({ where: { id: hid } })).toBeNull();
  });
});
