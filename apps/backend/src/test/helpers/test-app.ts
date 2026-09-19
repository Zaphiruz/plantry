import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../../app.js';
import { getTestPrisma } from './db.js';

export const TEST_ORIGIN = 'http://localhost:5173';
export interface TestUser { sub: string; name: string; cookie: string }
export interface CallResult { status: number; body: any; headers: Record<string, unknown> }

export interface TestCtx {
  app: FastifyInstance;
  prisma: PrismaClient;
  call(user: TestUser | null, method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<CallResult>;
  close(): Promise<void>;
}

export async function createTestApp(): Promise<TestCtx> {
  const prisma = getTestPrisma();
  const app = await buildApp({ prisma, frontendOrigin: TEST_ORIGIN, sessionSecret: 'test-secret', cookieSecure: false });
  await app.ready();
  return {
    app,
    prisma,
    async call(user, method, url, body, extraHeaders = {}) {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: {
          origin: TEST_ORIGIN,
          ...(user ? { cookie: user.cookie } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...extraHeaders,
        },
        ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
      });
      let parsed: unknown = null;
      try { parsed = res.body ? JSON.parse(res.body) : null; } catch { parsed = res.body; }
      return { status: res.statusCode, body: parsed, headers: res.headers };
    },
    async close() { await app.close(); },
  };
}
