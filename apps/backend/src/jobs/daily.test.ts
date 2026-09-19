import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';
import { runDaily, shouldCatchUp } from './daily.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

const NOW = new Date('2026-09-10T10:00:00Z');
const log = { info: () => {}, error: () => {} };
const deps = () => ({ prisma: ctx.prisma, frontendOrigin: 'x', push: ctx.push, storage: ctx.storage });

describe('daily runner', () => {
  it('runs stages in order and records the run', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.item(hid, { count: 2, min: 1 });
    await ctx.prisma.item.update({ where: { id: item.id }, data: { autoDeductQty: 1, autoDeductPeriodDays: 1 } });
    await ctx.prisma.inventory.update({ where: { itemId: item.id }, data: { lastAutoDeductAt: new Date(NOW.getTime() - 86_400_000) } });
    ctx.push.sent = [];
    expect(await runDaily(deps(), NOW, log)).toEqual({ ran: true });
    // auto-deduct took it 2 → 1 (== min), THEN the digest saw it as low:
    expect(ctx.push.sent).toHaveLength(1);
    const run = await ctx.prisma.jobRun.findUniqueOrThrow({ where: { job: 'daily' } });
    expect(run.lastRunAt!.toISOString()).toBe(NOW.toISOString());
    expect(run.startedAt).toBeNull();
  });

  it('concurrent starts: exactly one claims the run', async () => {
    const results = await Promise.all([runDaily(deps(), NOW, log), runDaily(deps(), NOW, log)]);
    expect(results.filter((r) => r.ran)).toHaveLength(1);
  });

  it('a stale claim (>1h) can be taken over; a fresh one cannot', async () => {
    await ctx.prisma.jobRun.create({ data: { job: 'daily', startedAt: new Date(NOW.getTime() - 10 * 60_000) } });
    expect((await runDaily(deps(), NOW, log)).ran).toBe(false);
    await ctx.prisma.jobRun.update({ where: { job: 'daily' }, data: { startedAt: new Date(NOW.getTime() - 2 * 3_600_000) } });
    expect((await runDaily(deps(), NOW, log)).ran).toBe(true);
  });

  it('a near-simultaneous distinct `now` cannot reclaim a just-completed run; a minute later it can', async () => {
    expect(await runDaily(deps(), NOW, log)).toEqual({ ran: true });
    expect(await runDaily(deps(), new Date(NOW.getTime() + 5_000), log)).toEqual({ ran: false });
    expect(await runDaily(deps(), new Date(NOW.getTime() + 61_000), log)).toEqual({ ran: true });
  });

  it('shouldCatchUp', () => {
    expect(shouldCatchUp(null, NOW)).toBe(true);
    expect(shouldCatchUp(new Date(NOW.getTime() - 25 * 3_600_000), NOW)).toBe(true);
    expect(shouldCatchUp(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe(false);
  });
});
