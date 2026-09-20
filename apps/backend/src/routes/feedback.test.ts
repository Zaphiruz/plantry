import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);
beforeEach(() => { ctx.github.issues = []; ctx.github.states.clear(); ctx.github.getCalls = 0; });

describe('feedback', () => {
  it('creates a labelled GitHub issue with submitter + page, and records it', async () => {
    const u = await ctx.user({ name: 'Ada' });
    const long = 'The shopping list should remember which aisle things are in, because I keep backtracking';
    const r = await ctx.call(u, 'POST', '/api/feedback', { body: long, pageUrl: '/h/abc/shopping' });
    expect(r.status).toBe(201);
    expect(r.body.data).toEqual({ issueNumber: 1, issueUrl: 'https://github.com/o/plantry/issues/1' });
    const issue = ctx.github.issues[0]!;
    expect(issue.labels).toEqual(['feedback', 'user-submitted']);
    expect(issue.title).toHaveLength(58);
    expect(issue.title.endsWith('…')).toBe(true);
    expect(issue.body).toContain(long);
    expect(issue.body).toContain(`Submitted by **Ada** (sub: ${u.sub})`);
    expect(issue.body).toContain('Page: `/h/abc/shopping`');
    expect((await ctx.call(u, 'GET', '/api/me')).body.data.feedbackEnabled).toBe(true);
  });

  it('omits a pageUrl that is not a same-site path', async () => {
    const u = await ctx.user();
    const bad = [
      'https://evil.example/pwn',
      '[click](https://evil.example)',
      '/ok`\n\n@maintainer please run `rm -rf /`',
      'javascript:alert(1)',
    ];
    for (const pageUrl of bad) {
      const r = await ctx.call(u, 'POST', '/api/feedback', { body: 'hi', pageUrl });
      expect(r.status).toBe(201);
      expect(ctx.github.issues.at(-1)!.body).not.toContain('Page:');
    }
  });

  it('limits each user to 5 submissions per 24h', async () => {
    const u = await ctx.user();
    for (let i = 0; i < 5; i++) expect((await ctx.call(u, 'POST', '/api/feedback', { body: `n${i}` })).status).toBe(201);
    const sixth = await ctx.call(u, 'POST', '/api/feedback', { body: 'again' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('rate_limited');
    expect(ctx.github.issues).toHaveLength(5);
  });

  it('/mine shows only my submissions with derived status; closed state is cached, open is re-checked after 1h', async () => {
    const a = await ctx.user(); const b = await ctx.user();
    await ctx.call(a, 'POST', '/api/feedback', { body: 'one' });
    await ctx.call(a, 'POST', '/api/feedback', { body: 'two' });
    await ctx.call(b, 'POST', '/api/feedback', { body: 'not mine' });
    ctx.github.states.set(2, { state: 'closed', state_reason: 'completed', closed_at: '2026-09-18T00:00:00Z' });

    const first = (await ctx.call(a, 'GET', '/api/feedback/mine')).body.data;
    expect(first.map((f: any) => [f.title, f.status])).toEqual([['two', 'done'], ['one', 'open']]);
    expect(first[0].closedAt).toBe('2026-09-18T00:00:00.000Z');
    expect(ctx.github.getCalls).toBe(2);

    await ctx.call(a, 'GET', '/api/feedback/mine');
    expect(ctx.github.getCalls).toBe(2); // both cached: one closed forever, one fetched <1h ago

    await ctx.prisma.feedbackSubmission.updateMany({ data: { stateFetchedAt: new Date(Date.now() - 2 * 3_600_000) } });
    ctx.github.states.set(1, { state: 'closed', state_reason: 'not_planned', closed_at: '2026-09-19T00:00:00Z' });
    const later = (await ctx.call(a, 'GET', '/api/feedback/mine')).body.data;
    expect(ctx.github.getCalls).toBe(3); // only the still-open one was re-checked
    expect(later.map((f: any) => f.status)).toEqual(['done', 'closed']);
  });

  it('routes do not exist when GitHub is not configured', async () => {
    const bare = await createTestApp({ github: false });
    try {
      const u = await bare.user();
      expect((await bare.call(u, 'POST', '/api/feedback', { body: 'x' })).status).toBe(404);
      expect((await bare.call(u, 'GET', '/api/me')).body.data.feedbackEnabled).toBe(false);
    } finally { await bare.close(); }
  });
});
