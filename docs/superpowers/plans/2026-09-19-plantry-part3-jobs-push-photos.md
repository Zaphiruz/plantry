# Plantry Plan — Part 3: Push, jobs, photos, server (Tasks 14–18)

Index + Global Constraints: [2026-09-19-plantry.md](2026-09-19-plantry.md). Test files reuse the harness boilerplate shown at the top of [part 2](2026-09-19-plantry-part2-inventory.md) (adjust the relative import depth to the file's folder).

---

### Task 14: Push service + subscription routes

**Files:**
- Create: `apps/backend/src/services/push.ts`, `apps/backend/src/routes/push.ts`
- Modify: `apps/backend/src/deps.ts`, `apps/backend/src/app.ts`, `apps/backend/src/test/helpers/fakes.ts`, `apps/backend/src/test/helpers/test-app.ts`
- Test: `apps/backend/src/services/push.test.ts`, `apps/backend/src/routes/push.test.ts`

**Interfaces:**
- Consumes: `PushSubscription` model, shared `pushSubscribeSchema`, `pushUnsubscribeSchema`.
- Produces:
  - `interface PushPayload { title: string; body: string; url: string }`
  - `interface PushService { publicKey: string; sendToUsers(userSubs: string[], payload: PushPayload): Promise<number> }` — returns the number of subscriptions a send was attempted on
  - `createPushService(prisma, cfg: { publicKey; privateKey; subject }, log?)`
  - `Deps.push?: PushService`; `BuildAppOptions.push?: PushService`, `BuildAppOptions.storage?: Storage`; `/api/me` now reports real `pushEnabled` / `photosEnabled`
  - `class FakePush implements PushService { sent: { userSubs: string[]; payload: PushPayload }[]; deliverCount = 1 }`
  - `createTestApp(opts?: { storage?: boolean; push?: boolean })` (both default `true`); `ctx.push: FakePush`
  - Routes: `GET /api/push/vapid-key`, `POST /api/push/subscriptions`, `DELETE /api/push/subscriptions`

- [ ] **Step 1: Failing service test**

`apps/backend/src/services/push.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestPrisma, resetDatabase } from '../test/helpers/db.js';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) } }));
const { createPushService } = await import('./push.js');

const prisma = getTestPrisma();
beforeEach(async () => {
  await resetDatabase();
  sendNotification.mockReset();
  await prisma.user.create({ data: { sub: 'u1', name: 'U', email: 'u@x', lastLoginAt: new Date() } });
  await prisma.pushSubscription.createMany({ data: [
    { endpoint: 'https://push/a', userSub: 'u1', p256dh: 'k', auth: 'a' },
    { endpoint: 'https://push/dead', userSub: 'u1', p256dh: 'k', auth: 'a' },
  ] });
});

describe('push service', () => {
  it('sends to every subscription and deletes the ones that are gone (404/410)', async () => {
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    });
    const svc = createPushService(prisma, { publicKey: 'pk', privateKey: 'sk', subject: 'mailto:x@y.z' });
    const attempted = await svc.sendToUsers(['u1'], { title: 't', body: 'b', url: '/x' });
    expect(attempted).toBe(2);
    expect(JSON.parse(sendNotification.mock.calls[0]![1] as string)).toEqual({ title: 't', body: 'b', url: '/x' });
    expect((await prisma.pushSubscription.findMany()).map((s) => s.endpoint)).toEqual(['https://push/a']);
  });

  it('other errors are logged, not thrown, and keep the subscription', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));
    const log = vi.fn();
    const svc = createPushService(prisma, { publicKey: 'pk', privateKey: 'sk', subject: 'mailto:x@y.z' }, log);
    await expect(svc.sendToUsers(['u1'], { title: 't', body: 'b', url: '/' })).resolves.toBe(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(await prisma.pushSubscription.count()).toBe(2);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement the service**

`apps/backend/src/services/push.ts`:
```ts
import webpush from 'web-push';
import type { PrismaClient } from '@prisma/client';

export interface PushPayload { title: string; body: string; url: string }
export interface PushService {
  publicKey: string;
  /** Sends synchronously (spec: fine at household scale). Returns how many subscriptions were attempted. */
  sendToUsers(userSubs: string[], payload: PushPayload): Promise<number>;
}
export interface PushConfig { publicKey: string; privateKey: string; subject: string }

export function createPushService(prisma: PrismaClient, cfg: PushConfig, log?: (err: unknown, msg: string) => void): PushService {
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return {
    publicKey: cfg.publicKey,
    async sendToUsers(userSubs, payload) {
      if (userSubs.length === 0) return 0;
      const subs = await prisma.pushSubscription.findMany({ where: { userSub: { in: userSubs } } });
      await Promise.all(subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
          } else {
            log?.(err, 'web-push send failed');
          }
        }
      }));
      return subs.length;
    },
  };
}
```

- [ ] **Step 3: Fakes, Deps, app wiring, harness**

`fakes.ts` — append:
```ts
import type { PushPayload, PushService } from '../../services/push.js';

export class FakePush implements PushService {
  publicKey = 'fake-vapid-public-key';
  sent: { userSubs: string[]; payload: PushPayload }[] = [];
  deliverCount = 1;
  async sendToUsers(userSubs: string[], payload: PushPayload): Promise<number> {
    this.sent.push({ userSubs: [...userSubs].sort(), payload });
    return this.deliverCount;
  }
}
```

`deps.ts` — add `import type { PushService } from './services/push.js';` and field `push?: PushService;`.

`app.ts`:
- add to `BuildAppOptions`: `push?: PushService; storage?: Storage;` (import both types)
- build deps as `{ prisma: options.prisma, frontendOrigin: options.frontendOrigin, ...(options.push ? { push: options.push } : {}), ...(options.storage ? { storage: options.storage } : {}) }`
- in `authDeps` set `photosEnabled: !!options.storage, pushEnabled: !!options.push`
- register `registerPushRoutes(app, deps);` after `registerInviteAcceptRoute`.

`test-app.ts`:
- signature `createTestApp(opts: { storage?: boolean; push?: boolean } = {})`
- `const push = new FakePush();` and pass `...(opts.push === false ? {} : { push })` to `buildApp`; expose `push` on `TestCtx`. (Storage is wired in Task 17.)

- [ ] **Step 4: Failing routes test**

`apps/backend/src/routes/push.test.ts` (after the boilerplate):
```ts
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
```

- [ ] **Step 5: Implement routes**

`apps/backend/src/routes/push.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { pushSubscribeSchema, pushUnsubscribeSchema } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { parse } from '../errors.js';

export function registerPushRoutes(app: FastifyInstance, deps: Deps): void {
  const auth = { preHandler: app.requireAuth };

  app.get('/api/push/vapid-key', auth, async () => ({ data: { publicKey: deps.push?.publicKey ?? null } }));

  app.post('/api/push/subscriptions', auth, async (req, reply) => {
    const b = parse(pushSubscribeSchema, req.body);
    const data = { userSub: req.user!.sub, p256dh: b.keys.p256dh, auth: b.keys.auth };
    await deps.prisma.pushSubscription.upsert({ where: { endpoint: b.endpoint }, create: { endpoint: b.endpoint, ...data }, update: data });
    return reply.code(204).send();
  });

  app.delete('/api/push/subscriptions', auth, async (req, reply) => {
    const b = parse(pushUnsubscribeSchema, req.body);
    await deps.prisma.pushSubscription.deleteMany({ where: { endpoint: b.endpoint, userSub: req.user!.sub } });
    return reply.code(204).send();
  });
}
```

- [ ] **Step 6: Run — expect pass; commit**

```bash
pnpm --filter @plantry/backend test && pnpm --filter @plantry/backend typecheck
git add -A && git commit -m "feat(backend): web push service and subscription routes"
```

---

### Task 15: Auto-deduct job

**Files:**
- Create: `apps/backend/src/jobs/auto-deduct.ts`
- Test: `apps/backend/src/jobs/auto-deduct.test.ts`

**Interfaces:**
- Consumes: `applyEvent`.
- Produces: `runAutoDeduct(prisma: PrismaClient, now: Date, log?: (err: unknown, msg: string) => void): Promise<{ deducted: number; failed: number }>`.

- [ ] **Step 1: Failing test**

`apps/backend/src/jobs/auto-deduct.test.ts` (after the boilerplate, imports from `'../test/helpers/...'`):
```ts
import { runAutoDeduct } from './auto-deduct.js';

const DAY = 86_400_000;
const T0 = new Date('2026-09-01T10:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);

async function autoItem(hid: string, qty: number, period: number, anchor: Date | null, extra: { paused?: boolean; archived?: boolean; count?: number } = {}) {
  const item = await ctx.item(hid, { count: extra.count ?? 100, archived: extra.archived });
  await ctx.prisma.item.update({ where: { id: item.id }, data: { autoDeductQty: qty, autoDeductPeriodDays: period, autoDeductPaused: extra.paused ?? false } });
  await ctx.prisma.inventory.update({ where: { itemId: item.id }, data: { lastAutoDeductAt: anchor } });
  return item;
}
const inv = (itemId: string) => ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId } });

describe('auto-deduct', () => {
  it('catches up whole periods and carries the remainder', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await autoItem(hid, 2, 1, T0);
    await runAutoDeduct(ctx.prisma, at(3.5));                     // 3 periods → −6, anchor = T0+3d
    let i = await inv(item.id);
    expect(Number(i.currentCount)).toBe(94);
    expect(i.lastAutoDeductAt!.toISOString()).toBe(at(3).toISOString());
    await runAutoDeduct(ctx.prisma, at(3.9));                     // 0.9 since anchor → nothing
    expect(Number((await inv(item.id)).currentCount)).toBe(94);
    await runAutoDeduct(ctx.prisma, at(4.1));                     // 1.1 → −2, anchor = T0+4d
    i = await inv(item.id);
    expect(Number(i.currentCount)).toBe(92);
    expect(i.lastAutoDeductAt!.toISOString()).toBe(at(4).toISOString());
    const evs = await ctx.prisma.inventoryEvent.findMany({ where: { itemId: item.id, eventType: 'auto_deduct' }, orderBy: { createdAt: 'asc' } });
    expect(evs.map((e) => [Number(e.quantity), e.userSub])).toEqual([[6, null], [2, null]]);
  });

  it('supports slow rates: 1 per 90 days stays whole until day 90', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await autoItem(hid, 1, 90, T0, { count: 1 });
    await runAutoDeduct(ctx.prisma, at(89.9));
    expect(Number((await inv(item.id)).currentCount)).toBe(1);
    await runAutoDeduct(ctx.prisma, at(91));
    const i = await inv(item.id);
    expect(Number(i.currentCount)).toBe(0);
    expect(i.lastAutoDeductAt!.toISOString()).toBe(at(90).toISOString());
  });

  it('skips paused, archived, and disabled items; goes negative happily', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const paused = await autoItem(hid, 5, 1, T0, { paused: true });
    const archived = await autoItem(hid, 5, 1, T0, { archived: true });
    const plain = await ctx.item(hid, { count: 100 });
    const neg = await autoItem(hid, 5, 1, T0, { count: 3 });
    const r = await runAutoDeduct(ctx.prisma, at(2));
    expect(r).toEqual({ deducted: 1, failed: 0 });
    for (const it of [paused, archived, plain]) expect(Number((await inv(it.id)).currentCount)).toBe(100);
    expect(Number((await inv(neg.id)).currentCount)).toBe(-7);
  });

  it('a missing anchor is initialised to now without deducting', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await autoItem(hid, 5, 1, null);
    await runAutoDeduct(ctx.prisma, at(10));
    const i = await inv(item.id);
    expect(Number(i.currentCount)).toBe(100);
    expect(i.lastAutoDeductAt!.toISOString()).toBe(at(10).toISOString());
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`apps/backend/src/jobs/auto-deduct.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import { applyEvent } from '../services/inventory.js';

const DAY_MS = 86_400_000;

/** Spec §5.2 — amount per period, whole periods only, anchor advances by whole periods so remainders carry. */
export async function runAutoDeduct(
  prisma: PrismaClient, now: Date, log?: (err: unknown, msg: string) => void,
): Promise<{ deducted: number; failed: number }> {
  const items = await prisma.item.findMany({
    where: { archivedAt: null, autoDeductPaused: false, autoDeductQty: { not: null } },
    include: { inventory: true },
  });
  let deducted = 0; let failed = 0;
  for (const item of items) {
    try {
      const anchor = item.inventory!.lastAutoDeductAt;
      if (!anchor) {
        await prisma.inventory.update({ where: { itemId: item.id }, data: { lastAutoDeductAt: now } });
        continue;
      }
      const periodMs = item.autoDeductPeriodDays * DAY_MS;
      const periods = Math.floor((now.getTime() - anchor.getTime()) / periodMs);
      if (periods < 1) continue;
      const quantity = Math.round(Number(item.autoDeductQty) * periods * 1000) / 1000;
      await prisma.$transaction(async (tx) => {
        await applyEvent(tx, { itemId: item.id, householdId: item.householdId, eventType: 'auto_deduct', quantity, userSub: null, now });
        await tx.inventory.update({
          where: { itemId: item.id }, data: { lastAutoDeductAt: new Date(anchor.getTime() + periods * periodMs) },
        });
      });
      deducted++;
    } catch (err) {
      failed++;
      log?.(err, `auto-deduct failed for item ${item.id}`);
    }
  }
  return { deducted, failed };
}
```

- [ ] **Step 3: Run — expect pass; commit**

```bash
pnpm --filter @plantry/backend test
git add -A && git commit -m "feat(backend): period-based auto-deduct job"
```

---

### Task 16: Low-stock digest job

**Files:**
- Create: `apps/backend/src/jobs/low-stock.ts`
- Test: `apps/backend/src/jobs/low-stock.test.ts`

**Interfaces:**
- Consumes: `PushService`, `lowItemsWhere`.
- Produces: `runLowStockDigest(prisma, push: PushService | undefined, now: Date): Promise<{ households: number; items: number }>`; `digestBody(names: string[]): string`.

- [ ] **Step 1: Failing test**

`apps/backend/src/jobs/low-stock.test.ts` (after the boilerplate):
```ts
import { digestBody, runLowStockDigest } from './low-stock.js';

const NOW = new Date('2026-09-10T06:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const notified = async (id: string) => (await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: id } })).lastNotifiedAt;

describe('digestBody', () => {
  it('formats counts and overflow', () => {
    expect(digestBody(['Cat food'])).toBe('1 item low — Cat food');
    expect(digestBody(['A', 'B'])).toBe('2 items low — A, B');
    expect(digestBody(['A', 'B', 'C', 'D'])).toBe('4 items low — A, B, +2');
  });
});

describe('low-stock digest', () => {
  it('sends one digest per household to all members and stamps last_notified_at', async () => {
    const o = await ctx.user(); const m = await ctx.user();
    const hid = await ctx.household(o, 'Casa'); await ctx.addMember(hid, m);
    const a = await ctx.item(hid, { name: 'Cat food', count: 1, min: 2 });
    const b = await ctx.item(hid, { name: 'Filters', count: 0, min: 0 });
    await ctx.item(hid, { name: 'Fine', count: 9, min: 1 });
    const r = await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect(r).toEqual({ households: 1, items: 2 });
    expect(ctx.push.sent).toEqual([{
      userSubs: [o.sub, m.sub].sort(),
      payload: { title: 'Casa', body: '2 items low — Cat food, Filters', url: `/h/${hid}/shopping` },
    }]);
    expect((await notified(a.id))!.toISOString()).toBe(NOW.toISOString());
    expect(await notified(b.id)).not.toBeNull();
  });

  it('honours per-item renotify_after_days', async () => {
    const o = await ctx.user(); const hid = await ctx.household(o);
    const daily = await ctx.item(hid, { name: 'Daily', count: 0, min: 1 });
    const weekly = await ctx.item(hid, { name: 'Weekly', count: 0, min: 1 });
    await ctx.prisma.item.update({ where: { id: daily.id }, data: { renotifyAfterDays: 1 } });
    await ctx.prisma.inventory.updateMany({ where: { itemId: { in: [daily.id, weekly.id] } }, data: { lastNotifiedAt: daysAgo(2) } });
    await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect(ctx.push.sent[0]!.payload.body).toBe('1 item low — Daily');
    expect((await notified(weekly.id))!.toISOString()).toBe(daysAgo(2).toISOString());
  });

  it('does not stamp when nothing could be delivered, or when push is off', async () => {
    const o = await ctx.user(); const hid = await ctx.household(o);
    const a = await ctx.item(hid, { count: 0, min: 1 });
    ctx.push.deliverCount = 0;
    await runLowStockDigest(ctx.prisma, ctx.push, NOW);
    expect(await notified(a.id)).toBeNull();
    await runLowStockDigest(ctx.prisma, undefined, NOW);
    expect(await notified(a.id)).toBeNull();
  });
});
```
Add `beforeEach(() => { ctx.push.sent = []; ctx.push.deliverCount = 1; });` under the boilerplate.

Run → FAIL.

- [ ] **Step 2: Implement**

`apps/backend/src/jobs/low-stock.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import { lowItemsWhere } from '../scoped/inventory.js';
import type { PushService } from '../services/push.js';

const DAY_MS = 86_400_000;

export function digestBody(names: string[]): string {
  const n = names.length;
  const shown = names.slice(0, 2).join(', ');
  return `${n} item${n === 1 ? '' : 's'} low — ${shown}${n > 2 ? `, +${n - 2}` : ''}`;
}

/** Spec §5.4 — one digest per household per run; per-item re-notify cadence. */
export async function runLowStockDigest(
  prisma: PrismaClient, push: PushService | undefined, now: Date,
): Promise<{ households: number; items: number }> {
  if (!push) return { households: 0, items: 0 };
  const households = await prisma.household.findMany({ include: { members: true } });
  let sentHouseholds = 0; let sentItems = 0;
  for (const h of households) {
    const low = await prisma.item.findMany({ where: lowItemsWhere(prisma, h.id), include: { inventory: true }, orderBy: { name: 'asc' } });
    const due = low.filter((i) => {
      const last = i.inventory!.lastNotifiedAt;
      return !last || now.getTime() - last.getTime() >= i.renotifyAfterDays * DAY_MS;
    });
    if (due.length === 0) continue;
    const attempted = await push.sendToUsers(h.members.map((m) => m.userSub), {
      title: h.name, body: digestBody(due.map((i) => i.name)), url: `/h/${h.id}/shopping`,
    });
    if (attempted === 0) continue; // nobody subscribed yet — notify as soon as someone is
    await prisma.inventory.updateMany({ where: { itemId: { in: due.map((i) => i.id) } }, data: { lastNotifiedAt: now } });
    sentHouseholds++; sentItems += due.length;
  }
  return { households: sentHouseholds, items: sentItems };
}
```

- [ ] **Step 3: Run — expect pass; commit**

```bash
pnpm --filter @plantry/backend test
git add -A && git commit -m "feat(backend): per-household low-stock push digest"
```

---

### Task 17: Storage service, photo routes, image URLs

**Files:**
- Modify: `apps/backend/src/services/storage.ts` (add the S3 implementation), `apps/backend/src/test/helpers/fakes.ts`, `apps/backend/src/test/helpers/test-app.ts`, `apps/backend/src/scoped/index.ts`, `apps/backend/src/scoped/members.ts`, `apps/backend/src/scoped/scoping-matrix.test.ts`
- Create: `apps/backend/src/scoped/photos.ts`
- Test: `apps/backend/src/scoped/photos.test.ts`

**Interfaces:**
- Consumes: `Storage`, `thumbKeyOf`, `loadItem`, `serializeItem`, shared `photoUploadSchema`, `photoFinalizeSchema`, `PhotoUploadDto`.
- Produces: `createS3Storage(cfg: { endpoint; publicEndpoint; region; bucket; accessKey; secretKey }): Storage`; `class FakeStorage implements Storage { objects: Map<string, Date>; put(key, at?) }`; `ctx.storage: FakeStorage`; routes `POST /items/:id/photo/upload-url`, `POST /items/:id/photo/finalize`, `DELETE /items/:id/photo`; household-deletion photo cleanup.

- [ ] **Step 1: FakeStorage + harness**

`fakes.ts` — append:
```ts
import type { Storage } from '../../services/storage.js';

export class FakeStorage implements Storage {
  objects = new Map<string, Date>();
  put(key: string, at = new Date()): void { this.objects.set(key, at); }
  async presignPut(key: string): Promise<string> { return `https://fake-s3/${key}?op=put`; }
  async presignGet(key: string): Promise<string> { return `https://fake-s3/${key}?op=get`; }
  async exists(key: string): Promise<boolean> { return this.objects.has(key); }
  async remove(keys: string[]): Promise<void> { for (const k of keys) this.objects.delete(k); }
  async list(prefix: string) {
    return [...this.objects].filter(([k]) => k.startsWith(prefix)).map(([key, lastModified]) => ({ key, lastModified }));
  }
}
```
`test-app.ts`: `const storage = new FakeStorage();` → pass `...(opts.storage === false ? {} : { storage })` to `buildApp`; expose `storage` on `TestCtx`.

- [ ] **Step 2: Failing test**

`apps/backend/src/scoped/photos.test.ts` (after the boilerplate; add `beforeEach(() => ctx.storage.objects.clear());`):
```ts
const OK = { mimeType: 'image/jpeg', sizeBytes: 120_000, thumbSizeBytes: 9_000 };
const thumb = (k: string) => k.replace(/\.jpg$/, '-thumb.jpg');

describe('item photos', () => {
  it('upload-url → finalize sets image_ref; item responses carry presigned GET urls', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid);
    const up = (await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/upload-url`, OK)).body.data;
    expect(up.key).toMatch(new RegExp(`^h/${hid}/items/${item.id}/[0-9a-f-]{36}\\.jpg$`));
    expect(up.uploadUrl).toContain(up.key);
    expect(up.thumbUploadUrl).toContain(thumb(up.key));

    const early = await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/finalize`, { key: up.key });
    expect(early.status).toBe(400); // objects not uploaded yet

    ctx.storage.put(up.key); ctx.storage.put(thumb(up.key));
    const fin = await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/finalize`, { key: up.key });
    expect(fin.status).toBe(200);
    expect(fin.body.data.imageUrl).toBe(`https://fake-s3/${up.key}?op=get`);
    expect(fin.body.data.thumbUrl).toBe(`https://fake-s3/${thumb(up.key)}?op=get`);
    expect(fin.body.data.imageUrlsExpireAt).not.toBeNull();
  });

  it('replacing deletes the previous pair; DELETE clears and removes', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid);
    const put = async () => {
      const up = (await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/upload-url`, OK)).body.data;
      ctx.storage.put(up.key); ctx.storage.put(thumb(up.key));
      await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/finalize`, { key: up.key });
      return up.key as string;
    };
    const first = await put(); const second = await put();
    expect(ctx.storage.objects.has(first)).toBe(false);
    expect(ctx.storage.objects.has(second)).toBe(true);
    expect((await ctx.call(u, 'DELETE', `${base}/items/${item.id}/photo`)).status).toBe(204);
    expect(ctx.storage.objects.size).toBe(0);
    expect((await ctx.call(u, 'GET', `${base}/items/${item.id}`)).body.data.imageUrl).toBeNull();
  });

  it('finalize refuses keys that belong to another item', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const a = await ctx.item(hid); const b = await ctx.item(hid);
    const up = (await ctx.call(u, 'POST', `${base}/items/${a.id}/photo/upload-url`, OK)).body.data;
    ctx.storage.put(up.key); ctx.storage.put(thumb(up.key));
    expect((await ctx.call(u, 'POST', `${base}/items/${b.id}/photo/finalize`, { key: up.key })).status).toBe(400);
  });

  it('deleting the household (last member leaves) removes its photos', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid);
    const up = (await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/upload-url`, OK)).body.data;
    ctx.storage.put(up.key); ctx.storage.put(thumb(up.key));
    await ctx.call(u, 'POST', `${base}/items/${item.id}/photo/finalize`, { key: up.key });
    await ctx.call(u, 'DELETE', `${base}/members/me`);
    expect(ctx.storage.objects.size).toBe(0);
  });

  it('is 503 photos_disabled without storage, and /me says so', async () => {
    const bare = await createTestApp({ storage: false });
    try {
      const u = await bare.user(); const hid = await bare.household(u); const item = await bare.item(hid);
      const r = await bare.call(u, 'POST', `/api/households/${hid}/items/${item.id}/photo/upload-url`, OK);
      expect(r.status).toBe(503);
      expect(r.body.error.code).toBe('photos_disabled');
      expect((await bare.call(u, 'GET', '/api/me')).body.data.photosEnabled).toBe(false);
    } finally { await bare.close(); }
  });
});
```

Run → FAIL.

- [ ] **Step 3: Photo routes**

`apps/backend/src/scoped/photos.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { photoFinalizeSchema, photoUploadSchema, type PhotoUploadDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, parse } from '../errors.js';
import { loadItem, serializeItem } from '../services/items.js';
import { thumbKeyOf, type Storage } from '../services/storage.js';

const disabled = () => new AppError(503, 'photos_disabled', 'Photo storage is not configured');

export function registerPhotoRoutes(s: FastifyInstance, deps: Deps): void {
  const requireStorage = (): Storage => { if (!deps.storage) throw disabled(); return deps.storage; };
  const prefixFor = (hid: string, itemId: string) => `h/${hid}/items/${itemId}/`;

  // Always load the item FIRST so scoping (404) wins over configuration (503).
  s.post<{ Params: { id: string } }>('/items/:id/photo/upload-url', async (req) => {
    const item = await loadItem(deps, req.household!.id, req.params.id);
    const storage = requireStorage();
    const b = parse(photoUploadSchema, req.body);
    const key = `${prefixFor(req.household!.id, item.id)}${randomUUID()}.jpg`;
    const data: PhotoUploadDto = {
      key,
      uploadUrl: await storage.presignPut(key, b.mimeType, b.sizeBytes),
      thumbUploadUrl: await storage.presignPut(thumbKeyOf(key), b.mimeType, b.thumbSizeBytes),
    };
    return { data };
  });

  s.post<{ Params: { id: string } }>('/items/:id/photo/finalize', async (req) => {
    const hid = req.household!.id;
    const item = await loadItem(deps, hid, req.params.id);
    const storage = requireStorage();
    const { key } = parse(photoFinalizeSchema, req.body);
    const prefix = prefixFor(hid, item.id);
    if (!key.startsWith(prefix) || !/^[0-9a-f-]{36}\.jpg$/.test(key.slice(prefix.length))) {
      throw new AppError(400, 'validation_error', 'Key does not belong to this item');
    }
    const [full, small] = await Promise.all([storage.exists(key), storage.exists(thumbKeyOf(key))]);
    if (!full || !small) throw new AppError(400, 'validation_error', 'Upload both objects before finalizing');
    await deps.prisma.item.update({ where: { id: item.id }, data: { imageRef: key } });
    if (item.imageRef && item.imageRef !== key) {
      await storage.remove([item.imageRef, thumbKeyOf(item.imageRef)]).catch((err) => req.log.error({ err }, 'old photo cleanup failed'));
    }
    return { data: await serializeItem(await loadItem(deps, hid, item.id), storage) };
  });

  s.delete<{ Params: { id: string } }>('/items/:id/photo', async (req, reply) => {
    const item = await loadItem(deps, req.household!.id, req.params.id);
    const storage = requireStorage();
    if (item.imageRef) {
      await deps.prisma.item.update({ where: { id: item.id }, data: { imageRef: null } });
      await storage.remove([item.imageRef, thumbKeyOf(item.imageRef)]);
    }
    return reply.code(204).send();
  });
}
```

Register in `scoped/index.ts`: `registerPhotoRoutes(s, deps);`.

In `scoped/members.ts`, replace the body of `DELETE /members/me` with:
```ts
    const result = await leaveHousehold(deps.prisma, req.household!.id, req.user!.sub);
    if (result.householdDeleted && deps.storage && result.imageRefs.length > 0) {
      const keys = result.imageRefs.flatMap((k) => [k, thumbKeyOf(k)]);
      await deps.storage.remove(keys).catch((err) => req.log.error({ err }, 'household photo cleanup failed'));
    }
    return reply.code(204).send();
```
(import `thumbKeyOf` from `../services/storage.js`).

In `scoping-matrix.test.ts` add to `BODIES`:
```ts
  'POST /items/:id/photo/upload-url': { mimeType: 'image/jpeg', sizeBytes: 1000, thumbSizeBytes: 100 },
  'POST /items/:id/photo/finalize': { key: 'h/x/items/y/z.jpg' },
```

- [ ] **Step 4: Real S3 implementation**

Append to `apps/backend/src/services/storage.ts`:
```ts
import {
  DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3Config { endpoint: string; publicEndpoint: string; region: string; bucket: string; accessKey: string; secretKey: string }

/**
 * Two clients, same pattern as Dinner Club's apps/backend/src/s3.ts: presigned URLs must be signed against the
 * PUBLIC hostname the browser will use; head/list/delete go over the internal endpoint.
 */
export function createS3Storage(cfg: S3Config): Storage {
  const make = (endpoint: string) => new S3Client({
    endpoint, region: cfg.region, forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
  });
  const internal = make(cfg.endpoint);
  const signer = make(cfg.publicEndpoint);
  const Bucket = cfg.bucket;

  return {
    presignPut: (Key, ContentType, ContentLength) =>
      getSignedUrl(signer, new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }), { expiresIn: PUT_TTL_SECONDS }),
    presignGet: (Key) => getSignedUrl(signer, new GetObjectCommand({ Bucket, Key }), { expiresIn: GET_TTL_SECONDS }),
    async exists(Key) {
      try { await internal.send(new HeadObjectCommand({ Bucket, Key })); return true; }
      catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return false;
        throw err;
      }
    },
    async remove(keys) {
      if (keys.length === 0) return;
      for (let i = 0; i < keys.length; i += 1000) {
        await internal.send(new DeleteObjectsCommand({
          Bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
        }));
      }
    },
    async list(Prefix) {
      const out: { key: string; lastModified: Date }[] = [];
      let ContinuationToken: string | undefined;
      do {
        const page = await internal.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
        for (const o of page.Contents ?? []) if (o.Key && o.LastModified) out.push({ key: o.Key, lastModified: o.LastModified });
        ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return out;
    },
  };
}
```
Move the two `import` statements to the top of the file.

Manual integration check against dev MinIO (not automated):
```bash
docker compose up -d minio minio-setup
pnpm --filter @plantry/backend exec tsx -e "
import { createS3Storage } from './src/services/storage.ts';
const s = createS3Storage({ endpoint:'http://localhost:9100', publicEndpoint:'http://localhost:9100', region:'us-east-1', bucket:'plantry-media', accessKey:'plantry', secretKey:'plantry-secret' });
const url = await s.presignPut('h/t/items/t/probe.jpg','image/jpeg',3);
const r = await fetch(url,{method:'PUT',headers:{'content-type':'image/jpeg'},body:new Uint8Array([1,2,3])});
console.log('put',r.status, 'exists', await s.exists('h/t/items/t/probe.jpg'), 'list', (await s.list('h/t/')).length);
await s.remove(['h/t/items/t/probe.jpg']); console.log('after remove', await s.exists('h/t/items/t/probe.jpg'));"
```
Expected: `put 200 exists true list 1` then `after remove false`.

- [ ] **Step 5: Run — expect pass; commit**

```bash
pnpm --filter @plantry/backend test && pnpm --filter @plantry/backend typecheck
git add -A && git commit -m "feat(backend): item photos via presigned MinIO uploads"
```

---

### Task 18: Sweeps, daily runner, config, `server.ts`

**Files:**
- Create: `apps/backend/src/jobs/sweeps.ts`, `apps/backend/src/jobs/daily.ts`, `apps/backend/src/config.ts`, `apps/backend/src/server.ts`
- Test: `apps/backend/src/jobs/sweeps.test.ts`, `apps/backend/src/jobs/daily.test.ts`, `apps/backend/src/config.test.ts`

**Interfaces:**
- Consumes: `runAutoDeduct`, `runLowStockDigest`, `Storage`, `thumbKeyOf`, `createS3Storage`, `createPushService`, `createOidcClient`, `buildApp`.
- Produces: `runSweeps(prisma, storage | undefined, now)`, `runDaily(deps: Deps, now: Date, log): Promise<{ ran: boolean }>`, `shouldCatchUp(lastRunAt: Date | null, now: Date): boolean`, `startDailySchedule(deps, log): { stop(): void }`, `loadConfig(env = process.env): AppConfig`.

- [ ] **Step 1: Failing sweeps test**

`apps/backend/src/jobs/sweeps.test.ts` (after the boilerplate; `beforeEach(() => ctx.storage.objects.clear());`):
```ts
import { runSweeps } from './sweeps.js';

const NOW = new Date('2026-09-10T06:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('sweeps', () => {
  it('removes expired sessions, stale invites, old checked-off free-text rows, and orphan photos only', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    await ctx.prisma.session.create({ data: { idHash: 'dead', userSub: u.sub, data: {}, expiresAt: hoursAgo(1) } });
    await ctx.prisma.householdInvite.createMany({ data: [
      { tokenHash: 'fresh', householdId: hid, createdBy: u.sub, expiresAt: new Date(NOW.getTime() + 1000) },
      { tokenHash: 'expired', householdId: hid, createdBy: u.sub, expiresAt: hoursAgo(1) },
    ] });
    await ctx.prisma.shoppingListItem.createMany({ data: [
      { householdId: hid, name: 'old checked', checkedOff: true, checkedOffAt: hoursAgo(25) },
      { householdId: hid, name: 'new checked', checkedOff: true, checkedOffAt: hoursAgo(2) },
      { householdId: hid, name: 'open' },
    ] });
    const item = await ctx.item(hid);
    const live = `h/${hid}/items/${item.id}/11111111-1111-1111-1111-111111111111.jpg`;
    await ctx.prisma.item.update({ where: { id: item.id }, data: { imageRef: live } });
    const liveThumb = live.replace('.jpg', '-thumb.jpg');
    ctx.storage.put(live, hoursAgo(100)); ctx.storage.put(liveThumb, hoursAgo(100));
    ctx.storage.put('h/x/items/y/old-orphan.jpg', hoursAgo(25));
    ctx.storage.put('h/x/items/y/in-flight.jpg', hoursAgo(1));

    await runSweeps(ctx.prisma, ctx.storage, NOW);

    expect(await ctx.prisma.session.count({ where: { idHash: 'dead' } })).toBe(0);
    expect(await ctx.prisma.session.count()).toBe(1); // u's live session
    expect((await ctx.prisma.householdInvite.findMany()).map((i) => i.tokenHash)).toEqual(['fresh']);
    expect((await ctx.prisma.shoppingListItem.findMany({ orderBy: { name: 'asc' } })).map((r) => r.name)).toEqual(['new checked', 'open']);
    expect([...ctx.storage.objects.keys()].sort()).toEqual(['h/x/items/y/in-flight.jpg', live, liveThumb].sort());
  });
});
```

- [ ] **Step 2: Implement sweeps**

`apps/backend/src/jobs/sweeps.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import { thumbKeyOf, type Storage } from '../services/storage.js';

const DAY_MS = 86_400_000;

export async function runSweeps(prisma: PrismaClient, storage: Storage | undefined, now: Date): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.householdInvite.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { acceptedAt: { lte: new Date(now.getTime() - 30 * DAY_MS) } }] },
  });
  await prisma.shoppingListItem.deleteMany({
    where: { itemId: null, checkedOff: true, checkedOffAt: { lte: new Date(now.getTime() - DAY_MS) } },
  });

  if (!storage) return;
  const refs = await prisma.item.findMany({ where: { imageRef: { not: null } }, select: { imageRef: true } });
  const live = new Set(refs.flatMap((r) => [r.imageRef!, thumbKeyOf(r.imageRef!)]));
  const cutoff = now.getTime() - DAY_MS; // leave in-flight uploads alone
  const orphans = (await storage.list('h/')).filter((o) => !live.has(o.key) && o.lastModified.getTime() <= cutoff).map((o) => o.key);
  await storage.remove(orphans);
}
```

- [ ] **Step 3: Failing daily test**

`apps/backend/src/jobs/daily.test.ts` (after the boilerplate):
```ts
import { runDaily, shouldCatchUp } from './daily.js';

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

  it('shouldCatchUp', () => {
    expect(shouldCatchUp(null, NOW)).toBe(true);
    expect(shouldCatchUp(new Date(NOW.getTime() - 25 * 3_600_000), NOW)).toBe(true);
    expect(shouldCatchUp(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe(false);
  });
});
```

- [ ] **Step 4: Implement the runner**

`apps/backend/src/jobs/daily.ts`:
```ts
import cron from 'node-cron';
import type { Deps } from '../deps.js';
import { runAutoDeduct } from './auto-deduct.js';
import { runLowStockDigest } from './low-stock.js';
import { runSweeps } from './sweeps.js';

export interface JobLog { info(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void }
const JOB = 'daily';
const STALE_CLAIM_MS = 60 * 60 * 1000;

export const shouldCatchUp = (lastRunAt: Date | null, now: Date): boolean =>
  !lastRunAt || now.getTime() - lastRunAt.getTime() > 24 * 60 * 60 * 1000;

/** Claim via an atomic row update — safe with Prisma's connection pool (session advisory locks are not). */
async function claim(deps: Deps, now: Date): Promise<boolean> {
  const stale = new Date(now.getTime() - STALE_CLAIM_MS);
  const rows = await deps.prisma.$queryRaw<{ job: string }[]>`
    INSERT INTO job_runs (job, started_at) VALUES (${JOB}, ${now})
    ON CONFLICT (job) DO UPDATE SET started_at = ${now}
      WHERE job_runs.started_at IS NULL OR job_runs.started_at < ${stale}
    RETURNING job`;
  return rows.length === 1;
}

export async function runDaily(deps: Deps, now: Date, log: JobLog): Promise<{ ran: boolean }> {
  if (!(await claim(deps, now))) return { ran: false };
  const stage = async (name: string, fn: () => Promise<unknown>) => {
    try { log.info({ stage: name, result: await fn() }, 'daily stage done'); }
    catch (err) { log.error({ err, stage: name }, 'daily stage failed'); }
  };
  await stage('auto-deduct', () => runAutoDeduct(deps.prisma, now, (err, msg) => log.error({ err }, msg)));
  await stage('low-stock', () => runLowStockDigest(deps.prisma, deps.push, now));
  await stage('sweeps', () => runSweeps(deps.prisma, deps.storage, now));
  await deps.prisma.jobRun.update({ where: { job: JOB }, data: { lastRunAt: now, startedAt: null } });
  return { ran: true };
}

/** 06:00 in the container's TZ, plus a boot catch-up if the last run is >24h old. */
export function startDailySchedule(deps: Deps, log: JobLog): { stop(): void } {
  const task = cron.schedule('0 6 * * *', () => { void runDaily(deps, new Date(), log); });
  void (async () => {
    const last = await deps.prisma.jobRun.findUnique({ where: { job: JOB } });
    if (shouldCatchUp(last?.lastRunAt ?? null, new Date())) await runDaily(deps, new Date(), log);
  })().catch((err) => log.error({ err }, 'boot catch-up failed'));
  return { stop: () => task.stop() };
}
```

- [ ] **Step 5: Config (test first)**

`apps/backend/src/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://x', SESSION_SECRET: 's', FRONTEND_ORIGIN: 'https://plantry.wispy-nook.casa',
  AUTHENTIK_ISSUER_URL: 'https://a/', AUTHENTIK_CLIENT_ID: 'id', AUTHENTIK_CLIENT_SECRET: 'sec', AUTHENTIK_REDIRECT_URI: 'https://p/cb',
};

describe('config', () => {
  it('push and photos are optional and all-or-nothing', () => {
    const c = loadConfig(base);
    expect(c.vapid).toBeNull(); expect(c.s3).toBeNull(); expect(c.adminGroup).toBe('plantry-admins');
    const full = loadConfig({ ...base, VAPID_PUBLIC_KEY: 'p', VAPID_PRIVATE_KEY: 'k', VAPID_SUBJECT: 'mailto:a@b.c',
      S3_ENDPOINT: 'http://m', S3_PUBLIC_ENDPOINT: 'https://m', S3_BUCKET: 'b', S3_ACCESS_KEY: 'a', S3_SECRET_KEY: 's' });
    expect(full.vapid?.publicKey).toBe('p');
    expect(full.s3).toMatchObject({ bucket: 'b', region: 'us-east-1' });
  });
  it('throws on missing required vars', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: '' })).toThrow(/SESSION_SECRET/);
  });
  it('refuses the dev bypass in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', AUTH_DEV_BYPASS: '1' })).toThrow(/AUTH_DEV_BYPASS/);
    expect(loadConfig({ ...base, AUTH_DEV_BYPASS: '1' }).devBypass).toBe(true);
  });
});
```

`apps/backend/src/config.ts`:
```ts
import type { PushConfig } from './services/push.js';
import type { S3Config } from './services/storage.js';

export interface AppConfig {
  port: number; nodeEnv: string; databaseUrl: string; frontendOrigin: string;
  sessionSecret: string; cookieSecure: boolean; adminGroup: string; devBypass: boolean;
  oidc: { issuer: string; clientId: string; clientSecret: string; redirectUri: string };
  vapid: PushConfig | null;
  s3: S3Config | null;
}
type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AppConfig {
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`Missing required environment variable: ${name}`);
    return v;
  };
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  const devBypass = env['AUTH_DEV_BYPASS'] === '1';
  if (devBypass && nodeEnv === 'production') throw new Error('AUTH_DEV_BYPASS must not be set in production');

  const vapid = env['VAPID_PUBLIC_KEY'] && env['VAPID_PRIVATE_KEY']
    ? { publicKey: env['VAPID_PUBLIC_KEY'], privateKey: env['VAPID_PRIVATE_KEY'], subject: env['VAPID_SUBJECT'] ?? 'mailto:noreply@wispy-nook.casa' }
    : null;
  const s3 = env['S3_ENDPOINT'] && env['S3_BUCKET'] && env['S3_ACCESS_KEY'] && env['S3_SECRET_KEY']
    ? { endpoint: env['S3_ENDPOINT'], publicEndpoint: env['S3_PUBLIC_ENDPOINT'] ?? env['S3_ENDPOINT'], region: env['S3_REGION'] ?? 'us-east-1',
        bucket: env['S3_BUCKET'], accessKey: env['S3_ACCESS_KEY'], secretKey: env['S3_SECRET_KEY'] }
    : null;

  return {
    port: Number(env['PORT'] ?? '3000'), nodeEnv,
    databaseUrl: required('DATABASE_URL'),
    frontendOrigin: required('FRONTEND_ORIGIN'),
    sessionSecret: required('SESSION_SECRET'),
    cookieSecure: (env['SESSION_COOKIE_SECURE'] ?? (nodeEnv === 'production' ? 'true' : 'false')) === 'true',
    adminGroup: env['AUTHENTIK_ADMIN_GROUP'] ?? 'plantry-admins',
    devBypass,
    oidc: {
      issuer: required('AUTHENTIK_ISSUER_URL'), clientId: required('AUTHENTIK_CLIENT_ID'),
      clientSecret: required('AUTHENTIK_CLIENT_SECRET'), redirectUri: required('AUTHENTIK_REDIRECT_URI'),
    },
    vapid, s3,
  };
}
```
For local dev with the bypass and no Authentik app yet, put any placeholder strings in the four `AUTHENTIK_*` vars — discovery is lazy and only happens on `/api/auth/login`.

- [ ] **Step 6: `server.ts`**

`apps/backend/src/server.ts`:
```ts
import { PrismaClient } from '@prisma/client';
import { buildApp } from './app.js';
import { createOidcClient } from './auth/oidc.js';
import { loadConfig } from './config.js';
import { startDailySchedule } from './jobs/daily.js';
import { createPushService } from './services/push.js';
import { createS3Storage } from './services/storage.js';

const config = loadConfig();
const prisma = new PrismaClient();
const storage = config.s3 ? createS3Storage(config.s3) : undefined;
const push = config.vapid
  ? createPushService(prisma, config.vapid, (err, msg) => console.error(JSON.stringify({ level: 'error', msg, err: String(err) })))
  : undefined;

const app = await buildApp({
  logger: true,
  prisma,
  frontendOrigin: config.frontendOrigin,
  sessionSecret: config.sessionSecret,
  cookieSecure: config.cookieSecure,
  adminGroup: config.adminGroup,
  devBypass: config.devBypass,
  oidcClient: createOidcClient(config.oidc),
  ...(storage ? { storage } : {}),
  ...(push ? { push } : {}),
});

const schedule = startDailySchedule(
  { prisma, frontendOrigin: config.frontendOrigin, ...(storage ? { storage } : {}), ...(push ? { push } : {}) },
  app.log,
);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    schedule.stop();
    void app.close().then(() => prisma.$disconnect()).then(() => process.exit(0));
  });
}

await app.listen({ host: '0.0.0.0', port: config.port });
app.log.info({ photos: !!storage, push: !!push, devBypass: config.devBypass }, 'plantry backend ready');
```

- [ ] **Step 7: Run everything + smoke the server**

```bash
pnpm --filter @plantry/backend test && pnpm --filter @plantry/backend typecheck && pnpm --filter @plantry/backend build
pnpm --filter @plantry/backend dev
```
In another shell: `curl -s localhost:3000/health` → `{"status":"ok"}`; `curl -si "localhost:3000/api/auth/dev-login?sub=me&name=Me" | head -5` → `302` with a `plantry_sid` cookie. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(backend): daily job runner, sweeps, config, server entry"
```

---

### Task 18A: GitHub feedback (same system as Velvet Scoop / Two Cents)

In-app feedback creates a GitHub issue in the Plantry repo (labels `feedback`, `user-submitted`), remembers it per user, and shows its status (open / done / closed) back to the submitter. Reference: `D:\code\Velvet Scoop\website-v2\apps\backend\src\routes\feedback.ts` and `services/github.ts`. One deliberate improvement over the reference: Velvet Scoop fetches an issue's state once and never again, so "open" never flips to "done"; here non-closed issues are re-fetched when their cached state is more than 1 hour old.

**Files:**
- Modify: `packages/shared/src/constants.ts`, `schemas.ts`, `types.ts`
- Modify: `apps/backend/prisma/schema.prisma` (+ new migration `add_feedback_submissions`)
- Create: `apps/backend/src/services/github.ts`, `apps/backend/src/routes/feedback.ts`
- Modify: `apps/backend/src/deps.ts`, `app.ts`, `auth/routes.ts`, `config.ts`, `server.ts`, `test/helpers/fakes.ts`, `test/helpers/test-app.ts`
- Test: `apps/backend/src/routes/feedback.test.ts`

**Interfaces:**
- Consumes: `app.requireAuth`, `AppError`, `parse`.
- Produces:
  - shared: error code `rate_limited` (429); `feedbackSchema = { body: string 1..4000, pageUrl?: string ≤ 500 }`; `interface FeedbackDto { id: string; issueNumber: number; issueUrl: string; title: string; createdAt: string; status: 'open' | 'done' | 'closed'; closedAt: string | null }`; `MeDto.feedbackEnabled: boolean`
  - `interface GithubClient { createIssue(args: { title; body; labels? }): Promise<{ number: number; html_url: string }>; getIssue(number): Promise<{ state: 'open' | 'closed'; state_reason: 'completed' | 'not_planned' | 'reopened' | null; closed_at: string | null }> }`, `createGithubClient({ token, owner, repo })`
  - `Deps.github?: GithubClient`; `BuildAppOptions.github?`; `AppConfig.github: { token; owner; repo } | null` from `GITHUB_FEEDBACK_TOKEN` + `GITHUB_FEEDBACK_REPO` (`owner/repo`)
  - `class FakeGithub implements GithubClient { issues: {...}[]; states: Map<number, ...> }`; `ctx.github`
  - Routes: `POST /api/feedback` → 201 `{ data: { issueNumber, issueUrl } }`; `GET /api/feedback/mine` → `{ data: FeedbackDto[] }`. Routes are only registered when `deps.github` is set.

- [ ] **Step 1: Shared additions**

`constants.ts`: add `'rate_limited'` to `ERROR_CODES`.

`schemas.ts`: append
```ts
export const feedbackSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  pageUrl: z.string().max(500).optional(),
}).strict();
```

`types.ts`: add `feedbackEnabled: boolean` to `MeDto`, and append
```ts
export interface FeedbackDto {
  id: string; issueNumber: number; issueUrl: string; title: string; createdAt: string;
  status: 'open' | 'done' | 'closed'; closedAt: string | null;
}
```

- [ ] **Step 2: Schema + migration**

Add to `schema.prisma` (and `feedback FeedbackSubmission[]` to `model User`):
```prisma
model FeedbackSubmission {
  id             String    @id @default(uuid()) @db.Uuid
  userSub        String    @map("user_sub")
  issueNumber    Int       @map("issue_number")
  issueUrl       String    @map("issue_url")
  title          String
  state          String?
  stateReason    String?   @map("state_reason")
  closedAt       DateTime? @map("closed_at") @db.Timestamptz(6)
  stateFetchedAt DateTime? @map("state_fetched_at") @db.Timestamptz(6)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  user           User      @relation(fields: [userSub], references: [sub], onDelete: Cascade)

  @@index([userSub, createdAt])
  @@map("feedback_submissions")
}
```
```bash
pnpm --filter @plantry/backend prisma migrate dev --name add_feedback_submissions
pnpm --filter @plantry/backend test:db:setup
```
Open the generated SQL and apply the **drift note** from Task 2 (delete any `DROP INDEX` for the two partial indexes). `resetDatabase()` needs no change — rows cascade when users are deleted.

- [ ] **Step 3: Fake + harness**

`fakes.ts` — append:
```ts
import type { GithubClient } from '../../services/github.js';

export class FakeGithub implements GithubClient {
  issues: { title: string; body: string; labels?: string[] }[] = [];
  states = new Map<number, { state: 'open' | 'closed'; state_reason: 'completed' | 'not_planned' | 'reopened' | null; closed_at: string | null }>();
  getCalls = 0;
  async createIssue(args: { title: string; body: string; labels?: string[] }) {
    this.issues.push(args);
    const number = this.issues.length;
    return { number, html_url: `https://github.com/o/plantry/issues/${number}` };
  }
  async getIssue(number: number) {
    this.getCalls++;
    return this.states.get(number) ?? { state: 'open' as const, state_reason: null, closed_at: null };
  }
}
```
`test-app.ts`: `const github = new FakeGithub();` → pass `github` to `buildApp`; expose on `TestCtx`.

- [ ] **Step 4: Failing test**

`apps/backend/src/routes/feedback.test.ts` (after the boilerplate; `beforeEach(() => { ctx.github.issues = []; ctx.github.states.clear(); ctx.github.getCalls = 0; });`):
```ts
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
    expect(issue.body).toContain('Page: /h/abc/shopping');
    expect((await ctx.call(u, 'GET', '/api/me')).body.data.feedbackEnabled).toBe(true);
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
```
(`createTestApp` options gain `github?: boolean`, default `true`, same pattern as `storage` / `push`.)

Run → FAIL.

- [ ] **Step 5: GitHub client**

`apps/backend/src/services/github.ts` — copy `D:\code\Velvet Scoop\website-v2\apps\backend\src\services\github.ts` verbatim (it is dependency-free `fetch`; no changes needed).

- [ ] **Step 6: Routes**

`apps/backend/src/routes/feedback.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { FeedbackSubmission } from '@prisma/client';
import { feedbackSchema, type FeedbackDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, parse } from '../errors.js';
import type { GithubClient } from '../services/github.js';

const DAILY_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const RECHECK_MS = 60 * 60 * 1000;

function toDto(r: FeedbackSubmission): FeedbackDto {
  const status = r.state !== 'closed' ? 'open' : r.stateReason === 'completed' ? 'done' : 'closed';
  return {
    id: r.id, issueNumber: r.issueNumber, issueUrl: r.issueUrl, title: r.title, createdAt: r.createdAt.toISOString(),
    status, closedAt: status === 'open' ? null : r.closedAt?.toISOString() ?? null,
  };
}

export function registerFeedbackRoutes(app: FastifyInstance, deps: Deps & { github: GithubClient }): void {
  const auth = { preHandler: app.requireAuth };

  app.post('/api/feedback', auth, async (req, reply) => {
    const b = parse(feedbackSchema, req.body);
    const user = req.user!;
    const recent = await deps.prisma.feedbackSubmission.count({
      where: { userSub: user.sub, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
    if (recent >= DAILY_LIMIT) throw new AppError(429, 'rate_limited', 'Too many submissions — try again tomorrow');

    const title = b.body.length > 60 ? `${b.body.slice(0, 57)}…` : b.body;
    const issue = await deps.github.createIssue({
      title,
      body: [b.body, '', '---', `Submitted by **${user.name}** (sub: ${user.sub})`, ...(b.pageUrl ? [`Page: ${b.pageUrl}`] : [])].join('\n'),
      labels: ['feedback', 'user-submitted'],
    });
    const row = await deps.prisma.feedbackSubmission.create({
      data: { userSub: user.sub, issueNumber: issue.number, issueUrl: issue.html_url, title },
    });
    return reply.code(201).send({ data: { issueNumber: row.issueNumber, issueUrl: row.issueUrl } });
  });

  app.get('/api/feedback/mine', auth, async (req) => {
    const rows = await deps.prisma.feedbackSubmission.findMany({ where: { userSub: req.user!.sub }, orderBy: { createdAt: 'desc' } });
    const stale = rows.filter((r) => r.state !== 'closed' && (!r.stateFetchedAt || Date.now() - r.stateFetchedAt.getTime() > RECHECK_MS));
    const results = await Promise.allSettled(stale.map((r) => deps.github.getIssue(r.issueNumber)));
    for (const [i, result] of results.entries()) {
      const row = stale[i]!;
      if (result.status === 'rejected') { req.log.warn({ err: result.reason, issueNumber: row.issueNumber }, 'feedback state refresh failed'); continue; }
      const patch = {
        state: result.value.state, stateReason: result.value.state_reason,
        closedAt: result.value.closed_at ? new Date(result.value.closed_at) : null, stateFetchedAt: new Date(),
      };
      await deps.prisma.feedbackSubmission.update({ where: { id: row.id }, data: patch });
      Object.assign(row, patch);
    }
    return { data: rows.map(toDto) };
  });
}
```
Note the 58-character title in the test: 57 characters + `…`.

- [ ] **Step 7: Wiring**

- `deps.ts`: `github?: GithubClient;`
- `app.ts`: `BuildAppOptions.github?: GithubClient`; include it in `deps`; after `registerPushRoutes`: `if (deps.github) registerFeedbackRoutes(app, { ...deps, github: deps.github });`
- `auth/routes.ts`: add `feedbackEnabled: boolean` to `AuthRouteDeps` and to the `/api/me` payload; in `app.ts` set `feedbackEnabled: !!options.github`.
- `config.ts`: add to `AppConfig` `github: { token: string; owner: string; repo: string } | null;` and in `loadConfig`:
```ts
  const [ghOwner, ghRepo] = (env['GITHUB_FEEDBACK_REPO'] ?? '').split('/');
  const github = env['GITHUB_FEEDBACK_TOKEN'] && ghOwner && ghRepo ? { token: env['GITHUB_FEEDBACK_TOKEN'], owner: ghOwner, repo: ghRepo } : null;
```
  plus a `config.test.ts` case: `loadConfig({ ...base, GITHUB_FEEDBACK_TOKEN: 't', GITHUB_FEEDBACK_REPO: 'Zaphiruz/plantry' }).github` equals `{ token: 't', owner: 'Zaphiruz', repo: 'plantry' }`, and `loadConfig(base).github` is `null`.
- `server.ts`: `const github = config.github ? createGithubClient(config.github) : undefined;` → pass `...(github ? { github } : {})` to `buildApp`; add `feedback: !!github` to the ready log line.
- `.env.example`: add `GITHUB_FEEDBACK_TOKEN=` and `GITHUB_FEEDBACK_REPO=`.

- [ ] **Step 8: Run — expect pass; commit**

```bash
pnpm test && pnpm typecheck
git add -A && git commit -m "feat(backend): in-app feedback filed as GitHub issues"
```
