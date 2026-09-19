import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from './test/helpers/test-app.js';
import { resetDatabase } from './test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

describe('app skeleton', () => {
  it('GET /health', async () => {
    const r = await ctx.call(null, 'GET', '/health');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('unknown routes use the error envelope', async () => {
    const r = await ctx.call(null, 'GET', '/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
  });

  it('rejects mutations from a foreign origin', async () => {
    const r = await ctx.call(null, 'POST', '/api/nope', {}, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('forbidden');
  });

  it('seeds 13 global units and reset keeps them', async () => {
    expect(await ctx.prisma.unit.count({ where: { householdId: null } })).toBe(13);
  });

  it('exposes a route table', () => {
    expect(ctx.app.routeTable.some((r) => r.url === '/health')).toBe(true);
  });
});
