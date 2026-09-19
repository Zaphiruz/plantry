import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } });

describe('push routes', () => {
  it('exposes the VAPID key and pushEnabled in /me', async () => {
    const u = await ctx.user();
    expect((await ctx.call(u, 'GET', '/api/push/vapid-key')).body.data.publicKey).toBe('fake-vapid-public-key');
    expect((await ctx.call(u, 'GET', '/api/me')).body.data.pushEnabled).toBe(true);
  });

  it('subscribe upserts by endpoint (re-assigning the user); unsubscribe only removes your own', async () => {
    const a = await ctx.user(); const b = await ctx.user();
    expect((await ctx.call(a, 'POST', '/api/push/subscriptions', sub('https://push.example/1'))).status).toBe(204);
    expect((await ctx.call(b, 'POST', '/api/push/subscriptions', sub('https://push.example/1'))).status).toBe(204);
    const rows = await ctx.prisma.pushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userSub).toBe(b.sub);
    await ctx.call(a, 'DELETE', '/api/push/subscriptions', { endpoint: 'https://push.example/1' });
    expect(await ctx.prisma.pushSubscription.count()).toBe(1);
    await ctx.call(b, 'DELETE', '/api/push/subscriptions', { endpoint: 'https://push.example/1' });
    expect(await ctx.prisma.pushSubscription.count()).toBe(0);
  });

  it('requires auth', async () => {
    expect((await ctx.call(null, 'POST', '/api/push/subscriptions', sub('https://push.example/1'))).status).toBe(401);
  });
});
