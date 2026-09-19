import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

const tokenOf = (url: string) => url.split('/invite/')[1]!;

describe('invites', () => {
  it('any member creates a 7-day link; accepting joins as member', async () => {
    const owner = await ctx.user(); const m = await ctx.user(); const guest = await ctx.user();
    const hid = await ctx.household(owner); await ctx.addMember(hid, m);
    const inv = await ctx.call(m, 'POST', `/api/households/${hid}/invites`);
    expect(inv.status).toBe(200);
    expect(inv.body.data.url).toMatch(/^http:\/\/localhost:5173\/invite\/.{43,}$/);
    const days = (new Date(inv.body.data.expiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9); expect(days).toBeLessThan(7.1);

    const acc = await ctx.call(guest, 'POST', `/api/invites/${tokenOf(inv.body.data.url)}/accept`);
    expect(acc.status).toBe(200);
    expect(acc.body.data).toMatchObject({ id: hid, role: 'member' });
  });

  it('is single-use, but idempotent for someone already a member', async () => {
    const owner = await ctx.user(); const g1 = await ctx.user(); const g2 = await ctx.user();
    const hid = await ctx.household(owner);
    const token = tokenOf((await ctx.call(owner, 'POST', `/api/households/${hid}/invites`)).body.data.url);
    expect((await ctx.call(g1, 'POST', `/api/invites/${token}/accept`)).status).toBe(200);
    expect((await ctx.call(g1, 'POST', `/api/invites/${token}/accept`)).status).toBe(200);
    const second = await ctx.call(g2, 'POST', `/api/invites/${token}/accept`);
    expect(second.status).toBe(410);
    expect(second.body.error.code).toBe('invite_invalid');
  });

  it('an existing member accepting does not consume the invite', async () => {
    const owner = await ctx.user(); const guest = await ctx.user();
    const hid = await ctx.household(owner);
    const token = tokenOf((await ctx.call(owner, 'POST', `/api/households/${hid}/invites`)).body.data.url);
    expect((await ctx.call(owner, 'POST', `/api/invites/${token}/accept`)).body.data.role).toBe('owner');
    expect((await ctx.call(guest, 'POST', `/api/invites/${token}/accept`)).status).toBe(200);
  });

  it('expired and unknown tokens are 410', async () => {
    const owner = await ctx.user(); const guest = await ctx.user();
    const hid = await ctx.household(owner);
    const token = tokenOf((await ctx.call(owner, 'POST', `/api/households/${hid}/invites`)).body.data.url);
    await ctx.prisma.householdInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await ctx.call(guest, 'POST', `/api/invites/${token}/accept`)).status).toBe(410);
    expect((await ctx.call(guest, 'POST', '/api/invites/nope/accept')).status).toBe(410);
  });
});
