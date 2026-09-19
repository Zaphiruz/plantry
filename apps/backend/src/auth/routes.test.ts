import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

function cookieFrom(headers: Record<string, unknown>, name: string): string | undefined {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  const hit = list.find((c) => c.startsWith(`${name}=`));
  return hit?.split(';')[0];
}

describe('auth', () => {
  it('login sets the signed state cookie and redirects to the provider', async () => {
    const r = await ctx.call(null, 'GET', '/api/auth/login');
    expect(r.status).toBe(302);
    expect(r.headers['location']).toBe('https://auth.example/authorize');
    expect(cookieFrom(r.headers, 'plantry_oidc')).toBeDefined();
  });

  it('callback upserts the user, creates a session, redirects home', async () => {
    ctx.fakeOidc.userinfo = { sub: 'abc', email: 'a@b.c', name: 'Ada', groups: ['plantry-admins'], idToken: 't' };
    const login = await ctx.call(null, 'GET', '/api/auth/login');
    const state = cookieFrom(login.headers, 'plantry_oidc')!;
    const cb = await ctx.call(null, 'GET', '/api/auth/callback?code=c&state=state-0', undefined, { cookie: state });
    expect(cb.status).toBe(302);
    expect(cb.headers['location']).toBe('http://localhost:5173/');
    const sid = cookieFrom(cb.headers, 'plantry_sid')!;
    expect(sid).toBeDefined();
    const me = await ctx.call(null, 'GET', '/api/me', undefined, { cookie: sid });
    expect(me.status).toBe(200);
    expect(me.body.data.user).toEqual({ sub: 'abc', name: 'Ada', email: 'a@b.c', isAdmin: true });
    expect(me.body.data.households).toEqual([]);
  });

  it('callback rejects a state mismatch', async () => {
    const login = await ctx.call(null, 'GET', '/api/auth/login');
    const state = cookieFrom(login.headers, 'plantry_oidc')!;
    const cb = await ctx.call(null, 'GET', '/api/auth/callback?code=c&state=WRONG', undefined, { cookie: state });
    expect(cb.status).toBe(400);
  });

  it('/me is 401 without a session and isAdmin=false for plain users', async () => {
    expect((await ctx.call(null, 'GET', '/api/me')).status).toBe(401);
    const u = await ctx.user();
    const me = await ctx.call(u, 'GET', '/api/me');
    expect(me.body.data.user.isAdmin).toBe(false);
  });

  it('logout destroys the session', async () => {
    const u = await ctx.user();
    const out = await ctx.call(u, 'POST', '/api/auth/logout');
    expect(out.status).toBe(200);
    expect(out.body.data.endSessionUrl).toBe('https://auth.example/logout');
    expect((await ctx.call(u, 'GET', '/api/me')).status).toBe(401);
  });

  it('dev-login does not exist unless devBypass is on', async () => {
    expect((await ctx.call(null, 'GET', '/api/auth/dev-login?sub=x')).status).toBe(404);
  });
});
