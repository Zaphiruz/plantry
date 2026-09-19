import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';
import { acceptInvite } from './invites.js';

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

  it('concurrent accepts by two different non-members cannot both succeed (single-use race)', async () => {
    const owner = await ctx.user(); const g1 = await ctx.user(); const g2 = await ctx.user();
    const hid = await ctx.household(owner);
    const token = tokenOf((await ctx.call(owner, 'POST', `/api/households/${hid}/invites`)).body.data.url);

    // A plain concurrent-HTTP-call version of this test does not reliably
    // race against the local test database (both requests tend to complete
    // one fully before the other's first query is even issued). Force
    // genuine interleaving instead, the same way households.test.ts's
    // TOCTOU probe does: delay the *first* householdInvite.findUnique()
    // call system-wide so the second call has a real chance to also reach
    // its own read (both observing acceptedBy: null) before the first
    // transaction commits.
    let delayed = false;
    const probe = ctx.prisma.$extends({
      query: {
        householdInvite: {
          async findUnique({ args, query }) {
            const result = await query(args);
            if (!delayed) { delayed = true; await new Promise((r) => setTimeout(r, 30)); }
            return result;
          },
        },
      },
    }) as unknown as PrismaClient;

    const [r1, r2] = await Promise.allSettled([
      acceptInvite(probe, token, g1.sub),
      acceptInvite(probe, token, g2.sub),
    ]);

    const results = [r1, r2];
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const memberCount = await ctx.prisma.householdMember.count({ where: { householdId: hid } });
    expect(memberCount).toBe(2);
  });
});
