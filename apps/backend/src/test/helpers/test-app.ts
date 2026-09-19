import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../../app.js';
import { getTestPrisma } from './db.js';
import { createSessionStore } from '../../auth/session.js';
import { FakeOidcClient, FakePush } from './fakes.js';
import { applyEvent } from '../../services/inventory.js';

export interface ItemOpts { name?: string; count?: number; min?: number; storeId?: string; barcode?: string; archived?: boolean; defaultRestockQty?: number }

export const TEST_ORIGIN = 'http://localhost:5173';
export const TEST_COOKIE = 'plantry_sid';
export interface TestUser { sub: string; name: string; cookie: string }
export interface CallResult { status: number; body: any; headers: Record<string, unknown> }

export interface TestCtx {
  app: FastifyInstance;
  prisma: PrismaClient;
  fakeOidc: FakeOidcClient;
  push: FakePush;
  call(user: TestUser | null, method: string, url: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<CallResult>;
  user(opts?: { name?: string; admin?: boolean }): Promise<TestUser>;
  household(owner: TestUser, name?: string): Promise<string>;
  addMember(hid: string, user: TestUser, role?: 'owner' | 'member'): Promise<void>;
  item(hid: string, opts?: ItemOpts): Promise<import('@prisma/client').Item>;
  close(): Promise<void>;
}

export async function createTestApp(opts: { storage?: boolean; push?: boolean } = {}): Promise<TestCtx> {
  const prisma = getTestPrisma();
  const fakeOidc = new FakeOidcClient();
  const push = new FakePush();
  const sessions = createSessionStore(prisma, 3600);
  const app = await buildApp({
    prisma, frontendOrigin: TEST_ORIGIN, sessionSecret: 'test-secret', cookieSecure: false,
    oidcClient: fakeOidc, adminGroup: 'plantry-admins', devBypass: false, disableRateLimit: true,
    ...(opts.push === false ? {} : { push }),
  });
  await app.ready();
  let n = 0;
  return {
    app,
    prisma,
    fakeOidc,
    push,
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
    async user(opts = {}) {
      n++;
      const sub = `sub-${Date.now()}-${n}`;
      const name = opts.name ?? `User ${n}`;
      await prisma.user.create({ data: { sub, name, email: `u${n}@example.com`, lastLoginAt: new Date() } });
      const sid = await sessions.create(sub, { groups: opts.admin ? ['plantry-admins'] : [] });
      return { sub, name, cookie: `${TEST_COOKIE}=${sid}` };
    },
    async household(owner, name = 'Casa') {
      const h = await prisma.household.create({
        data: { name, members: { create: { userSub: owner.sub, role: 'owner' } } },
      });
      return h.id;
    },
    async addMember(hid, user, role = 'member') {
      await prisma.householdMember.create({ data: { householdId: hid, userSub: user.sub, role } });
    },
    async item(hid, opts = {}) {
      const each = await prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });
      const item = await prisma.item.create({
        data: {
          householdId: hid, name: opts.name ?? `Item ${++n}`, unitId: each.id,
          preferredStoreId: opts.storeId ?? null, barcode: opts.barcode ?? null,
          defaultRestockQty: opts.defaultRestockQty ?? 1,
          archivedAt: opts.archived ? new Date() : null,
          inventory: { create: { minStock: opts.min ?? 0 } },
        },
      });
      if (opts.count) {
        await prisma.$transaction((tx) => applyEvent(tx, {
          itemId: item.id, householdId: hid, eventType: 'adjust', quantity: opts.count!, userSub: null,
        }));
      }
      return item;
    },
    async close() { await app.close(); },
  };
}
