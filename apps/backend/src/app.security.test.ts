import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp, type BuildAppOptions } from './app.js';
import { getTestPrisma } from './test/helpers/db.js';
import { FakeOidcClient } from './test/helpers/fakes.js';

const TEST_ORIGIN = 'http://localhost:5173';
let app: FastifyInstance | undefined;

async function build(extra: Partial<BuildAppOptions> = {}): Promise<FastifyInstance> {
  const built = await buildApp({
    prisma: getTestPrisma(), frontendOrigin: TEST_ORIGIN, sessionSecret: 'test-secret', cookieSecure: false,
    oidcClient: new FakeOidcClient(), devBypass: false, ...extra,
  });
  await built.ready();
  app = built;
  return built;
}

afterEach(async () => { await app?.close(); app = undefined; });

describe('rate limiting', () => {
  it('returns 429 once the limit is exhausted', async () => {
    const a = await build({ rateLimitMax: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await a.inject({ method: 'GET', url: '/api/me', headers: { origin: TEST_ORIGIN } });
      codes.push(r.statusCode);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes[codes.length - 1]).toBe(429);
  });

  it('does not reset the bucket when X-Forwarded-For changes and no hops are trusted', async () => {
    const a = await build({ rateLimitMax: 3, trustProxyHops: 0 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await a.inject({
        method: 'GET', url: '/api/me',
        headers: { origin: TEST_ORIGIN, 'x-forwarded-for': `10.0.0.${i + 1}` },
      });
      codes.push(r.statusCode);
    }
    expect(codes[codes.length - 1]).toBe(429);
  });

  it('honours X-Forwarded-For when a hop is trusted', async () => {
    const a = await build({ rateLimitMax: 3, trustProxyHops: 1 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await a.inject({
        method: 'GET', url: '/api/me',
        headers: { origin: TEST_ORIGIN, 'x-forwarded-for': `10.0.0.${i + 1}` },
      });
      codes.push(r.statusCode);
    }
    expect(codes.every((c) => c !== 429)).toBe(true);
  });

  it('is not bypassed by sending a different plantry_sid cookie on every request', async () => {
    const a = await build({ rateLimitMax: 3 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await a.inject({
        method: 'GET', url: '/api/me',
        headers: { origin: TEST_ORIGIN, cookie: `plantry_sid=fake-sid-${i}-${Math.random()}` },
      });
      codes.push(r.statusCode);
    }
    expect(codes[codes.length - 1]).toBe(429);
  });
});

describe('GET /api/ready', () => {
  it('is 200 ok when the database answers', async () => {
    const a = await build({ disableRateLimit: true });
    const r = await a.inject({ method: 'GET', url: '/api/ready' });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ status: 'ok' });
  });

  it('is 503 degraded when the database query rejects', async () => {
    const broken = { $queryRaw: () => Promise.reject(new Error('db down')) } as unknown as PrismaClient;
    const a = await build({ disableRateLimit: true, prisma: broken });
    const r = await a.inject({ method: 'GET', url: '/api/ready' });
    expect(r.statusCode).toBe(503);
    expect(JSON.parse(r.body)).toEqual({ status: 'degraded' });
  });
});

describe('origin check', () => {
  it('rejects a mutating request with no Origin header', async () => {
    const a = await build({ disableRateLimit: true });
    const r = await a.inject({ method: 'POST', url: '/api/nope', payload: {} });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error.code).toBe('forbidden');
  });
});
