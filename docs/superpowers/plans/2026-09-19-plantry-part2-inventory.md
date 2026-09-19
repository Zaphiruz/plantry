# Plantry Plan — Part 2: Inventory domain (Tasks 6–13)

Index + Global Constraints: [2026-09-19-plantry.md](2026-09-19-plantry.md).

Every test file in this part starts with the same harness boilerplate — repeat it verbatim:
```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);
```

---

### Task 6: Stores & units

**Files:**
- Create: `apps/backend/src/scoped/stores.ts`, `apps/backend/src/scoped/units.ts`
- Modify: `apps/backend/src/lib/ids.ts`, `apps/backend/src/scoped/index.ts`
- Test: `apps/backend/src/scoped/stores-units.test.ts`

**Interfaces:**
- Consumes: scoped plugin (`req.household`), `parse`, `notFound`, `forbidden`, `AppError`, shared `storeCreateSchema`, `storeUpdateSchema`, `unitCreateSchema`, `unitUpdateSchema`, `StoreDto`, `UnitDto`.
- Produces: `uuidParam(v: unknown): string` (throws 404) in `lib/ids.ts`; `toUnitDto(u: Unit): UnitDto` exported from `scoped/units.ts`; `registerStoreRoutes(s, deps)`, `registerUnitRoutes(s, deps)`; routes `GET/POST /stores`, `PATCH/DELETE /stores/:id`, `GET/POST /units`, `PATCH/DELETE /units/:id`.

- [ ] **Step 1: Failing test**

`apps/backend/src/scoped/stores-units.test.ts` (after the boilerplate):
```ts
describe('stores', () => {
  it('CRUD, and delete nulls item references', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const base = `/api/households/${hid}`;
    const created = await ctx.call(u, 'POST', `${base}/stores`, { name: 'Costco', notes: 'bulk' });
    expect(created.status).toBe(200);
    const id = created.body.data.id;
    expect((await ctx.call(u, 'PATCH', `${base}/stores/${id}`, { name: 'Costco West' })).body.data.name).toBe('Costco West');
    expect((await ctx.call(u, 'GET', `${base}/stores`)).body.data).toHaveLength(1);

    const each = await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });
    const item = await ctx.prisma.item.create({
      data: { householdId: hid, name: 'Rice', unitId: each.id, preferredStoreId: id, inventory: { create: {} } },
    });
    expect((await ctx.call(u, 'DELETE', `${base}/stores/${id}`)).status).toBe(204);
    expect((await ctx.prisma.item.findUniqueOrThrow({ where: { id: item.id } })).preferredStoreId).toBeNull();
  });
});

describe('units', () => {
  it('lists globals + own, never another household’s', async () => {
    const a = await ctx.user(); const b = await ctx.user();
    const ha = await ctx.household(a); const hb = await ctx.household(b);
    await ctx.call(b, 'POST', `/api/households/${hb}/units`, { name: 'crate' });
    await ctx.call(a, 'POST', `/api/households/${ha}/units`, { name: 'sleeve', pluralName: 'sleeves' });
    const list = (await ctx.call(a, 'GET', `/api/households/${ha}/units`)).body.data;
    expect(list).toHaveLength(14);
    expect(list.filter((x: any) => !x.global).map((x: any) => x.name)).toEqual(['sleeve']);
  });

  it('globals are read-only', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const each = await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });
    expect((await ctx.call(u, 'PATCH', `/api/households/${hid}/units/${each.id}`, { name: 'x' })).status).toBe(403);
    expect((await ctx.call(u, 'DELETE', `/api/households/${hid}/units/${each.id}`)).status).toBe(403);
  });

  it('delete is blocked by active items (409 + count) and re-points archived ones', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const base = `/api/households/${hid}`;
    const unitId = (await ctx.call(u, 'POST', `${base}/units`, { name: 'sleeve' })).body.data.id;
    const active = await ctx.prisma.item.create({ data: { householdId: hid, name: 'Cups', unitId, inventory: { create: {} } } });
    const archived = await ctx.prisma.item.create({
      data: { householdId: hid, name: 'Old', unitId, archivedAt: new Date(), inventory: { create: {} } },
    });
    const blocked = await ctx.call(u, 'DELETE', `${base}/units/${unitId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({ code: 'unit_in_use', details: { itemCount: 1 } });

    await ctx.prisma.item.update({ where: { id: active.id }, data: { archivedAt: new Date() } });
    expect((await ctx.call(u, 'DELETE', `${base}/units/${unitId}`)).status).toBe(204);
    const each = await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });
    expect((await ctx.prisma.item.findUniqueOrThrow({ where: { id: archived.id } })).unitId).toBe(each.id);
  });
});
```

Run: `pnpm --filter @plantry/backend test src/scoped/stores-units.test.ts` → FAIL.

- [ ] **Step 2: Implement**

Append to `apps/backend/src/lib/ids.ts`:
```ts
import { notFound } from '../errors.js';
/** Validates a route param is a UUID; anything else is indistinguishable from "doesn't exist". */
export function uuidParam(v: unknown): string {
  if (!isUuid(v)) throw notFound();
  return v;
}
```

`apps/backend/src/scoped/stores.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { Store } from '@prisma/client';
import { storeCreateSchema, storeUpdateSchema, type StoreDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { notFound, parse } from '../errors.js';
import { uuidParam } from '../lib/ids.js';

const toDto = (s: Store): StoreDto => ({ id: s.id, name: s.name, notes: s.notes });

export function registerStoreRoutes(s: FastifyInstance, deps: Deps): void {
  const load = async (hid: string, id: unknown) => {
    const row = await deps.prisma.store.findFirst({ where: { id: uuidParam(id), householdId: hid } });
    if (!row) throw notFound();
    return row;
  };

  s.get('/stores', async (req) => {
    const rows = await deps.prisma.store.findMany({ where: { householdId: req.household!.id }, orderBy: { name: 'asc' } });
    return { data: rows.map(toDto) };
  });

  s.post('/stores', async (req) => {
    const body = parse(storeCreateSchema, req.body);
    const row = await deps.prisma.store.create({
      data: { householdId: req.household!.id, name: body.name, notes: body.notes ?? null },
    });
    return { data: toDto(row) };
  });

  s.patch<{ Params: { id: string } }>('/stores/:id', async (req) => {
    const existing = await load(req.household!.id, req.params.id);
    const body = parse(storeUpdateSchema, req.body);
    const row = await deps.prisma.store.update({
      where: { id: existing.id },
      data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}) },
    });
    return { data: toDto(row) };
  });

  s.delete<{ Params: { id: string } }>('/stores/:id', async (req, reply) => {
    const existing = await load(req.household!.id, req.params.id);
    await deps.prisma.store.delete({ where: { id: existing.id } }); // FKs are ON DELETE SET NULL
    return reply.code(204).send();
  });
}
```

`apps/backend/src/scoped/units.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { Unit } from '@prisma/client';
import { unitCreateSchema, unitUpdateSchema, type UnitDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, forbidden, notFound, parse } from '../errors.js';
import { uuidParam } from '../lib/ids.js';

export const toUnitDto = (u: Unit): UnitDto => ({
  id: u.id, name: u.name, pluralName: u.pluralName, abbreviation: u.abbreviation, global: u.householdId === null,
});

export function registerUnitRoutes(s: FastifyInstance, deps: Deps): void {
  const loadOwn = async (hid: string, id: unknown) => {
    const row = await deps.prisma.unit.findFirst({
      where: { id: uuidParam(id), OR: [{ householdId: hid }, { householdId: null }] },
    });
    if (!row) throw notFound();
    if (row.householdId === null) throw forbidden('Global units are read-only');
    return row;
  };

  s.get('/units', async (req) => {
    const rows = await deps.prisma.unit.findMany({
      where: { OR: [{ householdId: req.household!.id }, { householdId: null }] },
      orderBy: [{ name: 'asc' }],
    });
    return { data: rows.map(toUnitDto) };
  });

  s.post('/units', async (req) => {
    const b = parse(unitCreateSchema, req.body);
    const row = await deps.prisma.unit.create({
      data: { householdId: req.household!.id, name: b.name, pluralName: b.pluralName ?? null, abbreviation: b.abbreviation ?? null },
    });
    return { data: toUnitDto(row) };
  });

  s.patch<{ Params: { id: string } }>('/units/:id', async (req) => {
    const existing = await loadOwn(req.household!.id, req.params.id);
    const b = parse(unitUpdateSchema, req.body);
    const row = await deps.prisma.unit.update({
      where: { id: existing.id },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.pluralName !== undefined ? { pluralName: b.pluralName } : {}),
        ...(b.abbreviation !== undefined ? { abbreviation: b.abbreviation } : {}),
      },
    });
    return { data: toUnitDto(row) };
  });

  s.delete<{ Params: { id: string } }>('/units/:id', async (req, reply) => {
    const existing = await loadOwn(req.household!.id, req.params.id);
    await deps.prisma.$transaction(async (tx) => {
      const itemCount = await tx.item.count({ where: { unitId: existing.id, archivedAt: null } });
      if (itemCount > 0) throw new AppError(409, 'unit_in_use', `Unit is used by ${itemCount} item(s)`, { itemCount });
      const each = await tx.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });
      await tx.item.updateMany({ where: { unitId: existing.id }, data: { unitId: each.id } });
      await tx.unit.delete({ where: { id: existing.id } });
    });
    return reply.code(204).send();
  });
}
```

In `scoped/index.ts` import both and add `registerStoreRoutes(s, deps); registerUnitRoutes(s, deps);`.

- [ ] **Step 3: Run — expect pass; commit**

Run: `pnpm --filter @plantry/backend test`
```bash
git add -A
git commit -m "feat(backend): stores and units"
```

---

### Task 7: Inventory service — `applyEvent` / `undoEvent`

**Files:**
- Create: `apps/backend/src/services/inventory.ts`
- Modify: `apps/backend/src/test/helpers/test-app.ts`
- Test: `apps/backend/src/services/inventory.test.ts`

**Interfaces:**
- Consumes: Prisma models, `AppError`.
- Produces:
  - `type Db = Prisma.TransactionClient`
  - `signedDelta(eventType: EventType, quantity: number): number`
  - `applyEvent(db: Db, input: { itemId: string; householdId: string; eventType: EventType; quantity: number; userSub: string | null; note?: string | null; now?: Date }): Promise<InventoryEvent>`
  - `undoEvent(db: Db, event: InventoryEvent): Promise<void>`
  - Harness: `ctx.item(hid, opts?: { name?: string; count?: number; min?: number; storeId?: string; barcode?: string; archived?: boolean; defaultRestockQty?: number }) → Promise<Item>` (writes the initial count as an `adjust` event so the invariant holds)

- [ ] **Step 1: Harness `item()`**

Add to `TestCtx`: `item(hid: string, opts?: ItemOpts): Promise<import('@prisma/client').Item>;` and to the returned object:
```ts
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
```
with `import { applyEvent } from '../../services/inventory.js';` and
```ts
export interface ItemOpts { name?: string; count?: number; min?: number; storeId?: string; barcode?: string; archived?: boolean; defaultRestockQty?: number }
```

- [ ] **Step 2: Failing test**

`apps/backend/src/services/inventory.test.ts` (after the boilerplate):
```ts
import { applyEvent, signedDelta, undoEvent } from './inventory.js';

async function sumOfEvents(itemId: string): Promise<number> {
  const events = await ctx.prisma.inventoryEvent.findMany({ where: { itemId } });
  return events.reduce((acc, e) => acc + signedDelta(e.eventType, Number(e.quantity)), 0);
}
const count = async (itemId: string) => Number((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId } })).currentCount);

describe('applyEvent', () => {
  it('keeps current_count equal to the signed sum of events', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.item(hid, { count: 10 });
    const run = (eventType: any, quantity: number) =>
      ctx.prisma.$transaction((tx) => applyEvent(tx, { itemId: item.id, householdId: hid, eventType, quantity, userSub: u.sub }));
    await run('consume', 3); await run('restock', 2.5); await run('auto_deduct', 12); await run('adjust', -1.25);
    expect(await count(item.id)).toBeCloseTo(-3.75, 3);      // negative is allowed
    expect(await sumOfEvents(item.id)).toBeCloseTo(-3.75, 3);
  });

  it('rejects non-positive quantities except for adjust', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const item = await ctx.item(hid);
    await expect(ctx.prisma.$transaction((tx) =>
      applyEvent(tx, { itemId: item.id, householdId: hid, eventType: 'consume', quantity: 0, userSub: u.sub }))).rejects.toThrow();
  });

  it('restock stamps last_restocked_at; rising above min clears last_notified_at', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.item(hid, { count: 1, min: 2 });
    await ctx.prisma.inventory.update({ where: { itemId: item.id }, data: { lastNotifiedAt: new Date() } });
    const run = (q: number) => ctx.prisma.$transaction((tx) =>
      applyEvent(tx, { itemId: item.id, householdId: hid, eventType: 'restock', quantity: q, userSub: u.sub }));
    await run(1); // 2 <= min 2 → still low → keep
    expect((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } })).lastNotifiedAt).not.toBeNull();
    await run(1); // 3 > 2 → clear
    const inv = await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } });
    expect(inv.lastNotifiedAt).toBeNull();
    expect(inv.lastRestockedAt).not.toBeNull();
  });
});

describe('undoEvent', () => {
  it('deletes the event and reverses the count', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.item(hid, { count: 5 });
    const ev = await ctx.prisma.$transaction((tx) =>
      applyEvent(tx, { itemId: item.id, householdId: hid, eventType: 'consume', quantity: 2, userSub: u.sub }));
    await ctx.prisma.$transaction((tx) => undoEvent(tx, ev));
    expect(await count(item.id)).toBe(5);
    expect(await sumOfEvents(item.id)).toBe(5);
  });
});
```

Run → FAIL.

- [ ] **Step 3: Implement**

`apps/backend/src/services/inventory.ts`:
```ts
import type { EventType, InventoryEvent, Prisma } from '@prisma/client';
import { AppError } from '../errors.js';

export type Db = Prisma.TransactionClient;

export function signedDelta(eventType: EventType, quantity: number): number {
  switch (eventType) {
    case 'restock': return quantity;
    case 'consume':
    case 'auto_deduct': return -quantity;
    case 'adjust': return quantity; // adjust stores a signed delta
  }
}

export interface ApplyEventInput {
  itemId: string;
  householdId: string;
  eventType: EventType;
  quantity: number;
  userSub: string | null;
  note?: string | null;
  now?: Date;
}

async function clearNotifiedIfRecovered(db: Db, itemId: string): Promise<void> {
  const inv = await db.inventory.findUniqueOrThrow({ where: { itemId } });
  if (inv.lastNotifiedAt && inv.currentCount.gt(inv.minStock)) {
    await db.inventory.update({ where: { itemId }, data: { lastNotifiedAt: null } });
  }
}

/** The ONLY writer of inventory_events and inventory.current_count. Call inside a transaction. */
export async function applyEvent(db: Db, input: ApplyEventInput): Promise<InventoryEvent> {
  if (input.eventType !== 'adjust' && !(input.quantity > 0)) {
    throw new AppError(400, 'validation_error', 'quantity must be > 0');
  }
  const now = input.now ?? new Date();
  const event = await db.inventoryEvent.create({
    data: {
      itemId: input.itemId, householdId: input.householdId, eventType: input.eventType,
      quantity: input.quantity, userSub: input.userSub, note: input.note ?? null, createdAt: now,
    },
  });
  await db.inventory.update({
    where: { itemId: input.itemId },
    data: {
      currentCount: { increment: signedDelta(input.eventType, input.quantity) },
      ...(input.eventType === 'restock' ? { lastRestockedAt: now } : {}),
    },
  });
  await clearNotifiedIfRecovered(db, input.itemId);
  return event;
}

export async function undoEvent(db: Db, event: InventoryEvent): Promise<void> {
  await db.inventoryEvent.delete({ where: { id: event.id } });
  await db.inventory.update({
    where: { itemId: event.itemId },
    data: { currentCount: { decrement: signedDelta(event.eventType, Number(event.quantity)) } },
  });
}
```

- [ ] **Step 4: Run — expect pass; commit**

```bash
pnpm --filter @plantry/backend test
git add -A && git commit -m "feat(backend): applyEvent/undoEvent inventory service"
```

---

### Task 8: Items routes

**Files:**
- Create: `apps/backend/src/services/storage.ts` (interface only for now), `apps/backend/src/services/items.ts`, `apps/backend/src/scoped/items.ts`
- Modify: `apps/backend/src/deps.ts`, `apps/backend/src/scoped/index.ts`
- Test: `apps/backend/src/scoped/items.test.ts`

**Interfaces:**
- Consumes: `applyEvent`, `toUnitDto`, `uuidParam`, shared `itemCreateSchema`, `itemUpdateSchema`, `ItemDto`.
- Produces:
  - `interface Storage { presignPut(key, contentType, contentLength): Promise<string>; presignGet(key): Promise<string>; exists(key): Promise<boolean>; remove(keys: string[]): Promise<void>; list(prefix: string): Promise<{ key: string; lastModified: Date }[]> }`, `thumbKeyOf(key)`, `GET_TTL_SECONDS = 3600`, `PUT_TTL_SECONDS = 900` — `services/storage.ts`
  - `Deps` gains `storage?: Storage`
  - `itemInclude` (Prisma include const), `type ItemFull`, `serializeItem(item: ItemFull, storage?: Storage): Promise<ItemDto>`, `loadItem(deps, hid, id, opts?: { allowArchived?: boolean }): Promise<ItemFull>` — `services/items.ts`
  - Routes: `GET /items`, `POST /items`, `GET /items/:id`, `PATCH /items/:id`, `POST /items/:id/archive`, `POST /items/:id/unarchive`, `DELETE /items/:id`

- [ ] **Step 1: Failing test**

`apps/backend/src/scoped/items.test.ts` (after the boilerplate):
```ts
const eachId = async () => (await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } })).id;

describe('items', () => {
  it('creates with inventory; initial count is an adjust event', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const r = await ctx.call(u, 'POST', `/api/households/${hid}/items`,
      { name: 'Cat food', unitId: await eachId(), currentCount: 6, minStock: 4, barcode: '0123' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      name: 'Cat food', currentCount: 6, minStock: 4, low: false, defaultRestockQty: 1,
      unit: { name: 'each', global: true }, nextTripRowId: null, imageUrl: null,
    });
    const events = await ctx.prisma.inventoryEvent.findMany({ where: { itemId: r.body.data.id } });
    expect(events.map((e) => [e.eventType, Number(e.quantity)])).toEqual([['adjust', 6]]);
  });

  it('rejects units/stores from another household', async () => {
    const a = await ctx.user(); const b = await ctx.user();
    const ha = await ctx.household(a); const hb = await ctx.household(b);
    const foreignUnit = (await ctx.call(b, 'POST', `/api/households/${hb}/units`, { name: 'crate' })).body.data.id;
    const r = await ctx.call(a, 'POST', `/api/households/${ha}/items`, { name: 'X', unitId: foreignUnit });
    expect(r.status).toBe(400);
  });

  it('barcode is unique among active items; lookup by barcode and q', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    await ctx.item(hid, { name: 'Black beans', barcode: '111' });
    const dup = await ctx.call(u, 'POST', `${base}/items`, { name: 'Other', unitId: await eachId(), barcode: '111' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('barcode_conflict');
    expect((await ctx.call(u, 'GET', `${base}/items?barcode=111`)).body.data).toHaveLength(1);
    expect((await ctx.call(u, 'GET', `${base}/items?q=BEAN`)).body.data).toHaveLength(1);
    expect((await ctx.call(u, 'GET', `${base}/items?barcode=999`)).body.data).toEqual([]);
  });

  it('PATCH edits fields + minStock; enabling/editing/unpausing auto-deduct resets the anchor, restock-unrelated edits do not', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid);
    const anchor = async () => (await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } })).lastAutoDeductAt;
    expect(await anchor()).toBeNull();

    await ctx.call(u, 'PATCH', `${base}/items/${item.id}`, { autoDeductQty: 1, autoDeductPeriodDays: 90, minStock: 1 });
    const a1 = await anchor(); expect(a1).not.toBeNull();

    await ctx.prisma.inventory.update({ where: { itemId: item.id }, data: { lastAutoDeductAt: new Date('2026-01-01') } });
    await ctx.call(u, 'PATCH', `${base}/items/${item.id}`, { name: 'Renamed' });
    expect((await anchor())!.toISOString()).toBe('2026-01-01T00:00:00.000Z');

    await ctx.call(u, 'PATCH', `${base}/items/${item.id}`, { autoDeductPaused: true });
    expect((await anchor())!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    await ctx.call(u, 'PATCH', `${base}/items/${item.id}`, { autoDeductPaused: false });
    expect((await anchor())!.getTime()).toBeGreaterThan(new Date('2026-06-01').getTime());

    await ctx.call(u, 'PATCH', `${base}/items/${item.id}`, { autoDeductQty: null });
    expect(await anchor()).toBeNull();
  });

  it('archive hides from default list and drops next-trip rows; unarchive restores; barcode collision blocks unarchive', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { barcode: '222' });
    await ctx.prisma.shoppingListItem.create({ data: { householdId: hid, itemId: item.id, name: item.name } });
    expect((await ctx.call(u, 'POST', `${base}/items/${item.id}/archive`)).status).toBe(200);
    expect((await ctx.call(u, 'GET', `${base}/items`)).body.data).toHaveLength(0);
    expect((await ctx.call(u, 'GET', `${base}/items?archived=true`)).body.data).toHaveLength(1);
    expect(await ctx.prisma.shoppingListItem.count()).toBe(0);

    await ctx.item(hid, { barcode: '222' });
    expect((await ctx.call(u, 'POST', `${base}/items/${item.id}/unarchive`)).body.error.code).toBe('barcode_conflict');
  });

  it('hard delete: admin only, archived only, cascades', async () => {
    const admin = await ctx.user({ admin: true }); const pleb = await ctx.user();
    const hid = await ctx.household(admin); await ctx.addMember(hid, pleb);
    const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { count: 3 });
    expect((await ctx.call(pleb, 'DELETE', `${base}/items/${item.id}`)).status).toBe(403);
    const early = await ctx.call(admin, 'DELETE', `${base}/items/${item.id}`);
    expect(early.status).toBe(400);
    expect(early.body.error.code).toBe('archive_first');
    await ctx.call(admin, 'POST', `${base}/items/${item.id}/archive`);
    expect((await ctx.call(admin, 'DELETE', `${base}/items/${item.id}`)).status).toBe(204);
    expect(await ctx.prisma.inventoryEvent.count({ where: { itemId: item.id } })).toBe(0);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Storage interface + Deps**

`apps/backend/src/services/storage.ts`:
```ts
export interface Storage {
  presignPut(key: string, contentType: string, contentLength: number): Promise<string>;
  presignGet(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  remove(keys: string[]): Promise<void>;
  list(prefix: string): Promise<{ key: string; lastModified: Date }[]>;
}
export const GET_TTL_SECONDS = 3600;
export const PUT_TTL_SECONDS = 900;
export const thumbKeyOf = (key: string): string => key.replace(/\.jpg$/, '-thumb.jpg');
```

`apps/backend/src/deps.ts` — add `import type { Storage } from './services/storage.js';` and the field `storage?: Storage;`.

- [ ] **Step 3: Item service**

`apps/backend/src/services/items.ts`:
```ts
import type { Prisma } from '@prisma/client';
import type { ItemDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { notFound } from '../errors.js';
import { uuidParam } from '../lib/ids.js';
import { num, numOrNull } from '../lib/num.js';
import { toUnitDto } from '../scoped/units.js';
import { GET_TTL_SECONDS, thumbKeyOf, type Storage } from './storage.js';

export const itemInclude = {
  inventory: true,
  unit: true,
  preferredStore: true,
  listRows: { where: { checkedOff: false }, select: { id: true } },
} satisfies Prisma.ItemInclude;
export type ItemFull = Prisma.ItemGetPayload<{ include: typeof itemInclude }>;

export async function imageUrls(imageRef: string | null, storage?: Storage) {
  if (!imageRef || !storage) return { imageUrl: null, thumbUrl: null, imageUrlsExpireAt: null };
  const [imageUrl, thumbUrl] = await Promise.all([storage.presignGet(imageRef), storage.presignGet(thumbKeyOf(imageRef))]);
  return { imageUrl, thumbUrl, imageUrlsExpireAt: new Date(Date.now() + GET_TTL_SECONDS * 1000).toISOString() };
}

export async function serializeItem(i: ItemFull, storage?: Storage): Promise<ItemDto> {
  const inv = i.inventory!;
  const currentCount = num(inv.currentCount);
  const minStock = num(inv.minStock);
  return {
    id: i.id, name: i.name, description: i.description, category: i.category,
    unit: toUnitDto(i.unit), preferredStoreId: i.preferredStoreId, barcode: i.barcode,
    renotifyAfterDays: i.renotifyAfterDays, defaultRestockQty: num(i.defaultRestockQty),
    autoDeductQty: numOrNull(i.autoDeductQty), autoDeductPeriodDays: i.autoDeductPeriodDays,
    autoDeductPaused: i.autoDeductPaused,
    archivedAt: i.archivedAt?.toISOString() ?? null,
    currentCount, minStock, low: currentCount <= minStock,
    lastRestockedAt: inv.lastRestockedAt?.toISOString() ?? null,
    nextTripRowId: i.listRows[0]?.id ?? null,
    ...(await imageUrls(i.imageRef, storage)),
  };
}

export async function loadItem(deps: Deps, hid: string, id: unknown, opts: { allowArchived?: boolean } = {}): Promise<ItemFull> {
  const item = await deps.prisma.item.findFirst({
    where: { id: uuidParam(id), householdId: hid, ...(opts.allowArchived ? {} : { archivedAt: null }) },
    include: itemInclude,
  });
  if (!item) throw notFound();
  return item;
}
```

- [ ] **Step 4: Item routes**

`apps/backend/src/scoped/items.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { itemCreateSchema, itemUpdateSchema } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, parse } from '../errors.js';
import { applyEvent } from '../services/inventory.js';
import { itemInclude, loadItem, serializeItem } from '../services/items.js';
import { thumbKeyOf } from '../services/storage.js';

const barcodeConflict = () => new AppError(409, 'barcode_conflict', 'Another active item already uses this barcode');
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

export function registerItemRoutes(s: FastifyInstance, deps: Deps): void {
  const { prisma } = deps;

  async function assertRefs(hid: string, unitId?: string, storeId?: string | null): Promise<void> {
    if (unitId) {
      const ok = await prisma.unit.findFirst({ where: { id: unitId, OR: [{ householdId: hid }, { householdId: null }] } });
      if (!ok) throw new AppError(400, 'validation_error', 'Unknown unit');
    }
    if (storeId) {
      const ok = await prisma.store.findFirst({ where: { id: storeId, householdId: hid } });
      if (!ok) throw new AppError(400, 'validation_error', 'Unknown store');
    }
  }
  async function assertBarcodeFree(hid: string, barcode: string | null | undefined, exceptId?: string): Promise<void> {
    if (!barcode) return;
    const clash = await prisma.item.findFirst({
      where: { householdId: hid, barcode, archivedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (clash) throw barcodeConflict();
  }

  s.get<{ Querystring: { q?: string; barcode?: string; archived?: string } }>('/items', async (req) => {
    const { q, barcode, archived } = req.query;
    const items = await prisma.item.findMany({
      where: {
        householdId: req.household!.id,
        archivedAt: archived === 'true' ? { not: null } : null,
        ...(barcode ? { barcode } : {}),
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
      },
      include: itemInclude,
      orderBy: { name: 'asc' },
    });
    return { data: await Promise.all(items.map((i) => serializeItem(i, deps.storage))) };
  });

  s.post('/items', async (req) => {
    const hid = req.household!.id;
    const b = parse(itemCreateSchema, req.body);
    await assertRefs(hid, b.unitId, b.preferredStoreId);
    await assertBarcodeFree(hid, b.barcode);
    try {
      const id = await prisma.$transaction(async (tx) => {
        const item = await tx.item.create({
          data: {
            householdId: hid, name: b.name, description: b.description ?? null, category: b.category ?? null,
            unitId: b.unitId, preferredStoreId: b.preferredStoreId ?? null, barcode: b.barcode ?? null,
            renotifyAfterDays: b.renotifyAfterDays, defaultRestockQty: b.defaultRestockQty,
            autoDeductQty: b.autoDeductQty ?? null, autoDeductPeriodDays: b.autoDeductPeriodDays,
            autoDeductPaused: b.autoDeductPaused,
            inventory: { create: { minStock: b.minStock, lastAutoDeductAt: b.autoDeductQty ? new Date() : null } },
          },
        });
        if (b.currentCount !== 0) {
          await applyEvent(tx, {
            itemId: item.id, householdId: hid, eventType: 'adjust', quantity: b.currentCount,
            userSub: req.user!.sub, note: 'Initial count',
          });
        }
        return item.id;
      });
      return { data: await serializeItem(await loadItem(deps, hid, id), deps.storage) };
    } catch (e) {
      if (isUniqueViolation(e)) throw barcodeConflict();
      throw e;
    }
  });

  s.get<{ Params: { id: string } }>('/items/:id', async (req) => {
    const item = await loadItem(deps, req.household!.id, req.params.id, { allowArchived: true });
    return { data: await serializeItem(item, deps.storage) };
  });

  s.patch<{ Params: { id: string } }>('/items/:id', async (req) => {
    const hid = req.household!.id;
    const existing = await loadItem(deps, hid, req.params.id);
    const b = parse(itemUpdateSchema, req.body);
    await assertRefs(hid, b.unitId, b.preferredStoreId);
    if (b.barcode !== undefined) await assertBarcodeFree(hid, b.barcode, existing.id);

    const { minStock, ...itemFields } = b;
    const nextQty = b.autoDeductQty !== undefined ? b.autoDeductQty : existing.autoDeductQty === null ? null : Number(existing.autoDeductQty);
    const qtyChanged = b.autoDeductQty !== undefined && (b.autoDeductQty ?? null) !== (existing.autoDeductQty === null ? null : Number(existing.autoDeductQty));
    const periodChanged = b.autoDeductPeriodDays !== undefined && b.autoDeductPeriodDays !== existing.autoDeductPeriodDays;
    const unpaused = b.autoDeductPaused === false && existing.autoDeductPaused;
    const anchorUpdate =
      nextQty === null ? { lastAutoDeductAt: null }
      : qtyChanged || periodChanged || unpaused ? { lastAutoDeductAt: new Date() }
      : {};

    try {
      await prisma.$transaction(async (tx) => {
        await tx.item.update({ where: { id: existing.id }, data: itemFields });
        await tx.inventory.update({
          where: { itemId: existing.id },
          data: { ...(minStock !== undefined ? { minStock } : {}), ...anchorUpdate },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw barcodeConflict();
      throw e;
    }
    return { data: await serializeItem(await loadItem(deps, hid, existing.id), deps.storage) };
  });

  s.post<{ Params: { id: string } }>('/items/:id/archive', async (req) => {
    const hid = req.household!.id;
    const item = await loadItem(deps, hid, req.params.id);
    await prisma.$transaction([
      prisma.item.update({ where: { id: item.id }, data: { archivedAt: new Date(), archivedBy: req.user!.sub } }),
      prisma.shoppingListItem.deleteMany({ where: { itemId: item.id } }),
    ]);
    return { data: await serializeItem(await loadItem(deps, hid, item.id, { allowArchived: true }), deps.storage) };
  });

  s.post<{ Params: { id: string } }>('/items/:id/unarchive', async (req) => {
    const hid = req.household!.id;
    const item = await loadItem(deps, hid, req.params.id, { allowArchived: true });
    await assertBarcodeFree(hid, item.barcode, item.id);
    try {
      await prisma.item.update({ where: { id: item.id }, data: { archivedAt: null, archivedBy: null } });
    } catch (e) {
      if (isUniqueViolation(e)) throw barcodeConflict();
      throw e;
    }
    return { data: await serializeItem(await loadItem(deps, hid, item.id), deps.storage) };
  });

  s.delete<{ Params: { id: string } }>('/items/:id', { preHandler: s.requireAdmin }, async (req, reply) => {
    const item = await loadItem(deps, req.household!.id, req.params.id, { allowArchived: true });
    if (!item.archivedAt) throw new AppError(400, 'archive_first', 'Archive the item before deleting it');
    await prisma.item.delete({ where: { id: item.id } }); // cascades inventory, events, list rows, merges
    if (item.imageRef && deps.storage) {
      await deps.storage.remove([item.imageRef, thumbKeyOf(item.imageRef)]).catch((err) => req.log.error({ err }, 'photo cleanup failed'));
    }
    return reply.code(204).send();
  });
}
```

Register in `scoped/index.ts`: `registerItemRoutes(s, deps);`.

- [ ] **Step 5: Run — expect pass; commit**

```bash
pnpm --filter @plantry/backend test && pnpm --filter @plantry/backend typecheck
git add -A && git commit -m "feat(backend): item catalog routes with archive, barcode rules, admin hard delete"
```

---

### Task 9: Inventory routes

**Files:**
- Create: `apps/backend/src/scoped/inventory.ts`
- Modify: `apps/backend/src/scoped/index.ts`
- Test: `apps/backend/src/scoped/inventory.test.ts`

**Interfaces:**
- Consumes: `applyEvent`, `undoEvent`, `loadItem`, `serializeItem`, `itemInclude`, shared `restockSchema`, `consumeSchema`, `adjustSchema`, `UNDO_WINDOW_MS`, `EventDto`, `EventsPageDto`.
- Produces: routes `GET /inventory`, `GET /inventory/low`, `POST /inventory/:itemId/restock|consume|adjust` → `{ data: { item: ItemDto; eventId: string | null } }`, `GET /inventory/:itemId/events?cursor=`, `DELETE /inventory/events/:eventId` → 204. Exports `lowItemsWhere(prisma, hid)` for reuse by Task 11.

- [ ] **Step 1: Failing test**

`apps/backend/src/scoped/inventory.test.ts` (after the boilerplate):
```ts
describe('inventory routes', () => {
  it('restock / consume (default 1) / adjust', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { count: 5, min: 2 });
    expect((await ctx.call(u, 'POST', `${base}/inventory/${item.id}/consume`, {})).body.data.item.currentCount).toBe(4);
    expect((await ctx.call(u, 'POST', `${base}/inventory/${item.id}/consume`, { quantity: 2.5 })).body.data.item.currentCount).toBe(1.5);
    expect((await ctx.call(u, 'POST', `${base}/inventory/${item.id}/restock`, { quantity: 10 })).body.data.item.currentCount).toBe(11.5);
    const adj = await ctx.call(u, 'POST', `${base}/inventory/${item.id}/adjust`, { newCount: 7 });
    expect(adj.body.data.item.currentCount).toBe(7);
    const last = await ctx.prisma.inventoryEvent.findUniqueOrThrow({ where: { id: adj.body.data.eventId } });
    expect([last.eventType, Number(last.quantity)]).toEqual(['adjust', -4.5]);
    expect((await ctx.call(u, 'POST', `${base}/inventory/${item.id}/restock`, { quantity: 0 })).status).toBe(400);
  });

  it('adjust to the same count writes no event', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.item(hid, { count: 3 });
    const r = await ctx.call(u, 'POST', `/api/households/${hid}/inventory/${item.id}/adjust`, { newCount: 3 });
    expect(r.body.data.eventId).toBeNull();
  });

  it('/inventory/low lists count <= min, excluding archived', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    await ctx.item(hid, { name: 'ok', count: 5, min: 2 });
    await ctx.item(hid, { name: 'edge', count: 2, min: 2 });
    await ctx.item(hid, { name: 'neg', count: -1, min: 0 });
    await ctx.item(hid, { name: 'gone', count: 0, min: 5, archived: true });
    const low = (await ctx.call(u, 'GET', `${base}/inventory/low`)).body.data.map((i: any) => i.name);
    expect(low.sort()).toEqual(['edge', 'neg']);
    expect((await ctx.call(u, 'GET', `${base}/inventory`)).body.data).toHaveLength(3);
  });

  it('event history is newest-first with user names and paginates', async () => {
    const u = await ctx.user({ name: 'Ada' }); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid);
    for (let i = 0; i < 55; i++) await ctx.call(u, 'POST', `${base}/inventory/${item.id}/restock`, { quantity: 1 });
    const p1 = (await ctx.call(u, 'GET', `${base}/inventory/${item.id}/events`)).body.data;
    expect(p1.events).toHaveLength(50);
    expect(p1.events[0].userName).toBe('Ada');
    const p2 = (await ctx.call(u, 'GET', `${base}/inventory/${item.id}/events?cursor=${p1.nextCursor}`)).body.data;
    expect(p2.events).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();
  });

  it('undo: own event only, within 5 minutes, never auto_deduct', async () => {
    const u = await ctx.user(); const other = await ctx.user();
    const hid = await ctx.household(u); await ctx.addMember(hid, other);
    const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { count: 5 });
    const ev = (await ctx.call(u, 'POST', `${base}/inventory/${item.id}/consume`, {})).body.data.eventId;
    expect((await ctx.call(other, 'DELETE', `${base}/inventory/events/${ev}`)).status).toBe(403);
    expect((await ctx.call(u, 'DELETE', `${base}/inventory/events/${ev}`)).status).toBe(204);
    expect(Number((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } })).currentCount)).toBe(5);

    const old = (await ctx.call(u, 'POST', `${base}/inventory/${item.id}/consume`, {})).body.data.eventId;
    await ctx.prisma.inventoryEvent.update({ where: { id: old }, data: { createdAt: new Date(Date.now() - 6 * 60_000) } });
    const late = await ctx.call(u, 'DELETE', `${base}/inventory/events/${old}`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('undo_expired');
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`apps/backend/src/scoped/inventory.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
import { UNDO_WINDOW_MS, adjustSchema, consumeSchema, restockSchema, type EventDto, type EventsPageDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, forbidden, notFound, parse } from '../errors.js';
import { uuidParam } from '../lib/ids.js';
import { num } from '../lib/num.js';
import { applyEvent, undoEvent } from '../services/inventory.js';
import { itemInclude, loadItem, serializeItem } from '../services/items.js';

const PAGE = 50;

export function lowItemsWhere(prisma: PrismaClient, hid: string): Prisma.ItemWhereInput {
  return {
    householdId: hid,
    archivedAt: null,
    inventory: { is: { currentCount: { lte: prisma.inventory.fields.minStock } } },
  };
}

export function registerInventoryRoutes(s: FastifyInstance, deps: Deps): void {
  const { prisma } = deps;

  s.get('/inventory', async (req) => {
    const items = await prisma.item.findMany({
      where: { householdId: req.household!.id, archivedAt: null }, include: itemInclude, orderBy: { name: 'asc' },
    });
    return { data: await Promise.all(items.map((i) => serializeItem(i, deps.storage))) };
  });

  s.get('/inventory/low', async (req) => {
    const items = await prisma.item.findMany({
      where: lowItemsWhere(prisma, req.household!.id), include: itemInclude, orderBy: { name: 'asc' },
    });
    return { data: await Promise.all(items.map((i) => serializeItem(i, deps.storage))) };
  });

  async function respond(hid: string, itemId: string, eventId: string | null) {
    return { data: { item: await serializeItem(await loadItem(deps, hid, itemId), deps.storage), eventId } };
  }

  s.post<{ Params: { itemId: string } }>('/inventory/:itemId/restock', async (req) => {
    const hid = req.household!.id;
    const item = await loadItem(deps, hid, req.params.itemId);
    const b = parse(restockSchema, req.body);
    const ev = await prisma.$transaction((tx) => applyEvent(tx, {
      itemId: item.id, householdId: hid, eventType: 'restock', quantity: b.quantity, userSub: req.user!.sub, note: b.note,
    }));
    return respond(hid, item.id, ev.id);
  });

  s.post<{ Params: { itemId: string } }>('/inventory/:itemId/consume', async (req) => {
    const hid = req.household!.id;
    const item = await loadItem(deps, hid, req.params.itemId);
    const b = parse(consumeSchema, req.body ?? {});
    const ev = await prisma.$transaction((tx) => applyEvent(tx, {
      itemId: item.id, householdId: hid, eventType: 'consume', quantity: b.quantity, userSub: req.user!.sub, note: b.note,
    }));
    return respond(hid, item.id, ev.id);
  });

  s.post<{ Params: { itemId: string } }>('/inventory/:itemId/adjust', async (req) => {
    const hid = req.household!.id;
    const item = await loadItem(deps, hid, req.params.itemId);
    const b = parse(adjustSchema, req.body);
    const eventId = await prisma.$transaction(async (tx) => {
      const inv = await tx.inventory.findUniqueOrThrow({ where: { itemId: item.id } });
      const delta = Math.round((b.newCount - num(inv.currentCount)) * 1000) / 1000;
      if (delta === 0) return null;
      const ev = await applyEvent(tx, {
        itemId: item.id, householdId: hid, eventType: 'adjust', quantity: delta, userSub: req.user!.sub, note: b.note,
      });
      return ev.id;
    });
    return respond(hid, item.id, eventId);
  });

  s.get<{ Params: { itemId: string }; Querystring: { cursor?: string } }>('/inventory/:itemId/events', async (req) => {
    const item = await loadItem(deps, req.household!.id, req.params.itemId, { allowArchived: true });
    const cursor = req.query.cursor ? uuidParam(req.query.cursor) : undefined;
    const rows = await prisma.inventoryEvent.findMany({
      where: { itemId: item.id },
      include: { user: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, PAGE);
    const events: EventDto[] = page.map((e) => ({
      id: e.id, itemId: e.itemId, eventType: e.eventType, quantity: num(e.quantity), note: e.note,
      userSub: e.userSub, userName: e.user?.name ?? null, createdAt: e.createdAt.toISOString(),
    }));
    const data: EventsPageDto = { events, nextCursor: rows.length > PAGE ? page[page.length - 1]!.id : null };
    return { data };
  });

  s.delete<{ Params: { eventId: string } }>('/inventory/events/:eventId', async (req, reply) => {
    const ev = await prisma.inventoryEvent.findFirst({
      where: { id: uuidParam(req.params.eventId), householdId: req.household!.id },
    });
    if (!ev) throw notFound();
    if (ev.eventType === 'auto_deduct' || ev.userSub !== req.user!.sub) throw forbidden('You can only undo your own actions');
    if (Date.now() - ev.createdAt.getTime() > UNDO_WINDOW_MS) throw new AppError(409, 'undo_expired', 'Too late to undo');
    await prisma.$transaction((tx) => undoEvent(tx, ev));
    return reply.code(204).send();
  });
}
```

Register in `scoped/index.ts`: `registerInventoryRoutes(s, deps);`.

> If this Prisma version rejects the field reference inside the `inventory: { is: … }` relation filter, keep the `lowItemsWhere` signature but make it async and resolve ids with raw SQL instead: ``const ids = await prisma.$queryRaw<{ id: string }[]>`SELECT i.id FROM items i JOIN inventory v ON v.item_id = i.id WHERE i.household_id = ${hid}::uuid AND i.archived_at IS NULL AND v.current_count <= v.min_stock` `` and return `{ id: { in: ids.map((r) => r.id) } }` — then `await` it at the three call sites (here, `services/shopping.ts`, `jobs/low-stock.ts`).

- [ ] **Step 3: Run — expect pass; commit**

```bash
pnpm --filter @plantry/backend test && pnpm --filter @plantry/backend typecheck
git add -A && git commit -m "feat(backend): inventory routes with history and 5-minute undo"
```

---

### Task 10: Consumption rates

**Files:**
- Create: `apps/backend/src/services/rates.ts`, `apps/backend/src/scoped/rates.ts`
- Modify: `apps/backend/src/scoped/index.ts`
- Test: `apps/backend/src/services/rates.test.ts`

**Interfaces:**
- Consumes: `applyEvent` (with `now`), `loadItem`, shared `rateWindowSchema`, `windowDays`, `RateDto`, `RateWindow`.
- Produces: `consumptionRates(prisma, hid, window: RateWindow, opts?: { itemId?: string; now?: Date }): Promise<RateDto[]>`; routes `GET /items/consumption-rates?window=`, `GET /items/:id/consumption-rate?window=`.

- [ ] **Step 1: Failing test**

`apps/backend/src/services/rates.test.ts` (after the boilerplate):
```ts
import { applyEvent } from './inventory.js';
import { consumptionRates } from './rates.js';

const NOW = new Date('2026-09-01T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('consumption rates', () => {
  async function seed() {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.prisma.item.create({
      data: { householdId: hid, name: 'Old item', inventory: { create: {} },
        unitId: (await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } })).id },
    });
    const ev = (eventType: any, quantity: number, at: Date) => ctx.prisma.$transaction((tx) =>
      applyEvent(tx, { itemId: item.id, householdId: hid, eventType, quantity, userSub: null, now: at }));
    return { u, hid, item, ev };
  }

  it('sums consume + auto_deduct only, over the full window for old items', async () => {
    const { hid, item, ev } = await seed();
    await ev('restock', 100, daysAgo(200));
    await ev('consume', 6, daysAgo(20));
    await ev('auto_deduct', 9, daysAgo(10));
    await ev('adjust', -50, daysAgo(5));
    await ev('consume', 99, daysAgo(40)); // outside 30d
    const [r] = await consumptionRates(ctx.prisma, hid, '30d', { itemId: item.id, now: NOW });
    expect(r).toMatchObject({ itemId: item.id, window: '30d', days: 30 });
    expect(r!.avgPerDay).toBeCloseTo(15 / 30, 4);
  });

  it('young items divide by their age, floored at 1 day', async () => {
    const { hid, item, ev } = await seed();
    await ev('restock', 10, daysAgo(10));
    await ev('consume', 5, daysAgo(2));
    const [r] = await consumptionRates(ctx.prisma, hid, '90d', { itemId: item.id, now: NOW });
    expect(r!.days).toBeCloseTo(10, 5);
    expect(r!.avgPerDay).toBeCloseTo(0.5, 4);
  });

  it('an item with no usage reports zero', async () => {
    const { hid, item } = await seed();
    expect(await consumptionRates(ctx.prisma, hid, '30d', { itemId: item.id, now: NOW }))
      .toEqual([{ itemId: item.id, window: '30d', avgPerDay: 0, days: 30 }]);
  });

  it('route rejects windows outside the enum', async () => {
    const { u, hid, item } = await seed();
    const base = `/api/households/${hid}`;
    expect((await ctx.call(u, 'GET', `${base}/items/${item.id}/consumption-rate?window=7d`)).status).toBe(400);
    expect((await ctx.call(u, 'GET', `${base}/items/${item.id}/consumption-rate?window=60d`)).status).toBe(200);
    expect((await ctx.call(u, 'GET', `${base}/items/consumption-rates?window=30d`)).status).toBe(200);
    expect((await ctx.call(u, 'GET', `${base}/items/consumption-rates`)).status).toBe(400);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

`apps/backend/src/services/rates.ts`:
```ts
import { Prisma, type PrismaClient } from '@prisma/client';
import { windowDays, type RateDto, type RateWindow } from '@plantry/shared';

const DAY_MS = 86_400_000;

/** Derived on every call — never stored (spec §5.3). */
export async function consumptionRates(
  prisma: PrismaClient, hid: string, window: RateWindow, opts: { itemId?: string; now?: Date } = {},
): Promise<RateDto[]> {
  const now = opts.now ?? new Date();
  const wDays = windowDays(window);
  const since = new Date(now.getTime() - wDays * DAY_MS);
  const itemFilter = opts.itemId ? Prisma.sql`AND i.id = ${opts.itemId}::uuid` : Prisma.empty;

  const rows = await prisma.$queryRaw<{ item_id: string; total: Prisma.Decimal | null; first_at: Date | null }[]>`
    SELECT i.id AS item_id,
           (SELECT SUM(e.quantity) FROM inventory_events e
             WHERE e.item_id = i.id AND e.event_type IN ('consume', 'auto_deduct')
               AND e.created_at >= ${since} AND e.created_at <= ${now}) AS total,
           (SELECT MIN(e.created_at) FROM inventory_events e WHERE e.item_id = i.id) AS first_at
    FROM items i
    WHERE i.household_id = ${hid}::uuid AND i.archived_at IS NULL ${itemFilter}
    ORDER BY i.name`;

  return rows.map((r) => {
    const ageDays = r.first_at ? (now.getTime() - r.first_at.getTime()) / DAY_MS : wDays;
    const days = Math.max(1, Math.min(wDays, ageDays));
    const total = r.total ? Number(r.total) : 0;
    return { itemId: r.item_id, window, avgPerDay: Math.round((total / days) * 10_000) / 10_000, days };
  });
}
```

`apps/backend/src/scoped/rates.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { rateWindowSchema } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { parse } from '../errors.js';
import { loadItem } from '../services/items.js';
import { consumptionRates } from '../services/rates.js';

export function registerRateRoutes(s: FastifyInstance, deps: Deps): void {
  s.get<{ Querystring: { window?: string } }>('/items/consumption-rates', async (req) => {
    const window = parse(rateWindowSchema, req.query.window);
    return { data: await consumptionRates(deps.prisma, req.household!.id, window) };
  });

  s.get<{ Params: { id: string }; Querystring: { window?: string } }>('/items/:id/consumption-rate', async (req) => {
    const window = parse(rateWindowSchema, req.query.window);
    const item = await loadItem(deps, req.household!.id, req.params.id);
    const [rate] = await consumptionRates(deps.prisma, req.household!.id, window, { itemId: item.id });
    return { data: rate };
  });
}
```

Register in `scoped/index.ts`: `registerRateRoutes(s, deps);` — place it **before** `registerItemRoutes` for readability (find-my-way prefers the static `/items/consumption-rates` over `/items/:id` regardless).

- [ ] **Step 3: Run — expect pass; commit**

```bash
pnpm --filter @plantry/backend test
git add -A && git commit -m "feat(backend): derived consumption rates with fixed windows"
```

---

### Task 11: Shopping list

**Files:**
- Create: `apps/backend/src/services/shopping.ts`, `apps/backend/src/scoped/shopping.ts`
- Modify: `apps/backend/src/scoped/index.ts`
- Test: `apps/backend/src/scoped/shopping.test.ts`

**Interfaces:**
- Consumes: `lowItemsWhere`, `itemInclude`, `ItemFull`, `imageUrls`, `loadItem`, `applyEvent`, `toUnitDto`, shared `shoppingAddSchema`, `shoppingPatchSchema`, `purchaseSchema`, `ShoppingListDto`, `ShoppingEntry`, `PurchaseResultDto`.
- Produces: `buildShoppingList(deps, hid): Promise<ShoppingListDto>`, `purchase(deps, hid, itemId, quantity | undefined, userSub): Promise<string>`; routes `GET /shopping-list`, `POST /shopping-list/items/:itemId/purchase`, `POST /shopping-list-items`, `PATCH /shopping-list-items/:id`, `DELETE /shopping-list-items/:id`.

- [ ] **Step 1: Failing test**

`apps/backend/src/scoped/shopping.test.ts` (after the boilerplate):
```ts
describe('shopping list', () => {
  it('merges derived + linked-manual (deduped) + free-text, grouped by store with Any store last', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const costco = (await ctx.call(u, 'POST', `${base}/stores`, { name: 'Costco' })).body.data.id;
    const aldi = (await ctx.call(u, 'POST', `${base}/stores`, { name: 'Aldi' })).body.data.id;
    const lowAndManual = await ctx.item(hid, { name: 'Cat food', count: 1, min: 2, storeId: costco, defaultRestockQty: 12 });
    const manualOnly = await ctx.item(hid, { name: 'Coffee', count: 9, min: 1, storeId: aldi });
    await ctx.item(hid, { name: 'Plenty', count: 9, min: 1, storeId: aldi });
    await ctx.item(hid, { name: 'No store low', count: 0, min: 1 });

    expect((await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: lowAndManual.id })).status).toBe(200);
    expect((await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: manualOnly.id, quantity: 3 })).status).toBe(200);
    const dup = await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: manualOnly.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('already_on_list');
    await ctx.call(u, 'POST', `${base}/shopping-list-items`, { name: 'Birthday candles', storeId: aldi });

    const groups = (await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups;
    expect(groups.map((g: any) => g.store?.name ?? null)).toEqual(['Aldi', 'Costco', null]);
    expect(groups[0].entries.map((e: any) => [e.kind, e.name])).toEqual([['text', 'Birthday candles'], ['item', 'Coffee']]);
    expect(groups[0].entries[1]).toMatchObject({ low: false, manual: true, quantity: 3 });
    expect(groups[1].entries).toHaveLength(1);
    expect(groups[1].entries[0]).toMatchObject({ name: 'Cat food', low: true, manual: true, quantity: 12 });
    expect(groups[2].entries[0]).toMatchObject({ name: 'No store low', low: true, manual: false, rowId: null });
  });

  it('purchase restocks default qty, stamps last_checked_off_at, removes the manual row, and is undoable', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { count: 1, min: 2, defaultRestockQty: 12 });
    await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: item.id });
    const r = await ctx.call(u, 'POST', `${base}/shopping-list/items/${item.id}/purchase`);
    expect(r.status).toBe(200);
    const inv = await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } });
    expect(Number(inv.currentCount)).toBe(13);
    expect(inv.lastCheckedOffAt).not.toBeNull();
    expect(await ctx.prisma.shoppingListItem.count()).toBe(0);
    expect((await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups).toEqual([]);
    expect((await ctx.call(u, 'DELETE', `${base}/inventory/events/${r.body.data.eventId}`)).status).toBe(204);
    expect(Number((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } })).currentCount)).toBe(1);
  });

  it('purchase quantity precedence: body > row.quantity > default; still-low items stay listed', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const item = await ctx.item(hid, { count: 0, min: 10, defaultRestockQty: 4 });
    await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: item.id, quantity: 3 });
    await ctx.call(u, 'POST', `${base}/shopping-list/items/${item.id}/purchase`);               // row qty 3 → 3
    await ctx.call(u, 'POST', `${base}/shopping-list/items/${item.id}/purchase`, { quantity: 2 }); // body → 5
    await ctx.call(u, 'POST', `${base}/shopping-list/items/${item.id}/purchase`);               // default 4 → 9
    expect(Number((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } })).currentCount)).toBe(9);
    expect((await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups[0].entries[0].low).toBe(true);
  });

  it('free-text rows toggle checked_off and never touch inventory; linked rows cannot be PATCHed', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const row = (await ctx.call(u, 'POST', `${base}/shopping-list-items`, { name: 'Candles' })).body.data;
    const on = await ctx.call(u, 'PATCH', `${base}/shopping-list-items/${row.id}`, { checkedOff: true });
    expect(on.body.data.checkedOff).toBe(true);
    expect((await ctx.call(u, 'GET', `${base}/shopping-list`)).body.data.groups[0].entries[0].checkedOff).toBe(true);
    const item = await ctx.item(hid);
    const linked = (await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: item.id })).body.data;
    expect((await ctx.call(u, 'PATCH', `${base}/shopping-list-items/${linked.id}`, { checkedOff: true })).status).toBe(400);
    expect((await ctx.call(u, 'DELETE', `${base}/shopping-list-items/${linked.id}`)).status).toBe(204);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Service**

`apps/backend/src/services/shopping.ts`:
```ts
import type { ShoppingEntry, ShoppingGroup, ShoppingListDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { num, numOrNull } from '../lib/num.js';
import { lowItemsWhere } from '../scoped/inventory.js';
import { toUnitDto } from '../scoped/units.js';
import { applyEvent } from './inventory.js';
import { imageUrls, itemInclude, loadItem, type ItemFull } from './items.js';

export async function buildShoppingList(deps: Deps, hid: string): Promise<ShoppingListDto> {
  const { prisma } = deps;
  const [lowItems, rows] = await Promise.all([
    prisma.item.findMany({ where: lowItemsWhere(prisma, hid), include: itemInclude }),
    prisma.shoppingListItem.findMany({
      where: { householdId: hid, OR: [{ itemId: null }, { checkedOff: false }] },
      include: { store: true, item: { include: itemInclude } },
    }),
  ]);

  type Bucket = { store: ShoppingGroup['store']; entries: ShoppingEntry[] };
  const buckets = new Map<string, Bucket>();
  const bucketFor = (store: { id: string; name: string } | null | undefined): Bucket => {
    const key = store?.id ?? '';
    let b = buckets.get(key);
    if (!b) { b = { store: store ? { id: store.id, name: store.name } : null, entries: [] }; buckets.set(key, b); }
    return b;
  };

  const byItem = new Map<string, { item: ItemFull; low: boolean; rowId: string | null; rowQty: number | null }>();
  for (const item of lowItems) byItem.set(item.id, { item, low: true, rowId: null, rowQty: null });
  for (const row of rows) {
    if (!row.item) continue;
    if (row.item.archivedAt) continue;
    const existing = byItem.get(row.item.id);
    byItem.set(row.item.id, {
      item: row.item, low: existing?.low ?? false, rowId: row.id, rowQty: numOrNull(row.quantity),
    });
  }

  for (const { item, low, rowId, rowQty } of byItem.values()) {
    const { thumbUrl } = await imageUrls(item.imageRef, deps.storage);
    bucketFor(item.preferredStore).entries.push({
      kind: 'item', itemId: item.id, name: item.name, unit: toUnitDto(item.unit),
      quantity: rowQty ?? num(item.defaultRestockQty), low, manual: rowId !== null, rowId,
      currentCount: num(item.inventory!.currentCount), minStock: num(item.inventory!.minStock), thumbUrl,
    });
  }
  for (const row of rows) {
    if (row.itemId) continue;
    bucketFor(row.store).entries.push({
      kind: 'text', rowId: row.id, name: row.name, quantity: numOrNull(row.quantity), checkedOff: row.checkedOff,
    });
  }

  const groups = [...buckets.values()];
  for (const g of groups) g.entries.sort((a, b) => a.name.localeCompare(b.name));
  groups.sort((a, b) => (a.store === null ? 1 : b.store === null ? -1 : a.store.name.localeCompare(b.store.name)));
  return { groups };
}

/** Tap-to-restock. Quantity precedence: explicit > manual row quantity > item default. Returns the event id (for undo). */
export async function purchase(deps: Deps, hid: string, itemId: unknown, quantity: number | undefined, userSub: string): Promise<string> {
  const item = await loadItem(deps, hid, itemId);
  return deps.prisma.$transaction(async (tx) => {
    const row = await tx.shoppingListItem.findFirst({ where: { householdId: hid, itemId: item.id, checkedOff: false } });
    const qty = quantity ?? numOrNull(row?.quantity) ?? num(item.defaultRestockQty);
    const now = new Date();
    const ev = await applyEvent(tx, {
      itemId: item.id, householdId: hid, eventType: 'restock', quantity: qty, userSub, note: 'Shopping list', now,
    });
    await tx.inventory.update({ where: { itemId: item.id }, data: { lastCheckedOffAt: now } });
    await tx.shoppingListItem.deleteMany({ where: { householdId: hid, itemId: item.id } });
    return ev.id;
  });
}
```

- [ ] **Step 3: Routes**

`apps/backend/src/scoped/shopping.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { purchaseSchema, shoppingAddSchema, shoppingPatchSchema, type PurchaseResultDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, notFound, parse } from '../errors.js';
import { uuidParam } from '../lib/ids.js';
import { numOrNull } from '../lib/num.js';
import { loadItem } from '../services/items.js';
import { buildShoppingList, purchase } from '../services/shopping.js';

export function registerShoppingRoutes(s: FastifyInstance, deps: Deps): void {
  const { prisma } = deps;
  const rowDto = (r: { id: string; itemId: string | null; name: string; storeId: string | null; quantity: Prisma.Decimal | null; checkedOff: boolean }) =>
    ({ id: r.id, itemId: r.itemId, name: r.name, storeId: r.storeId, quantity: numOrNull(r.quantity), checkedOff: r.checkedOff });
  const loadRow = async (hid: string, id: unknown) => {
    const row = await prisma.shoppingListItem.findFirst({ where: { id: uuidParam(id), householdId: hid } });
    if (!row) throw notFound();
    return row;
  };

  s.get('/shopping-list', async (req) => ({ data: await buildShoppingList(deps, req.household!.id) }));

  s.post<{ Params: { itemId: string } }>('/shopping-list/items/:itemId/purchase', async (req) => {
    const b = parse(purchaseSchema, req.body ?? {});
    const data: PurchaseResultDto = {
      eventId: await purchase(deps, req.household!.id, req.params.itemId, b.quantity, req.user!.sub),
    };
    return { data };
  });

  s.post('/shopping-list-items', async (req) => {
    const hid = req.household!.id;
    const b = parse(shoppingAddSchema, req.body);
    if ('itemId' in b) {
      const item = await loadItem(deps, hid, b.itemId);
      try {
        const row = await prisma.shoppingListItem.create({
          data: { householdId: hid, itemId: item.id, name: item.name, quantity: b.quantity ?? null, addedBy: req.user!.sub },
        });
        return { data: rowDto(row) };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new AppError(409, 'already_on_list', 'Already on the next-trip list');
        }
        throw e;
      }
    }
    if (b.storeId) {
      const store = await prisma.store.findFirst({ where: { id: b.storeId, householdId: hid } });
      if (!store) throw new AppError(400, 'validation_error', 'Unknown store');
    }
    const row = await prisma.shoppingListItem.create({
      data: { householdId: hid, name: b.name, storeId: b.storeId ?? null, quantity: b.quantity ?? null, addedBy: req.user!.sub },
    });
    return { data: rowDto(row) };
  });

  s.patch<{ Params: { id: string } }>('/shopping-list-items/:id', async (req) => {
    const row = await loadRow(req.household!.id, req.params.id);
    const { checkedOff } = parse(shoppingPatchSchema, req.body);
    if (row.itemId) throw new AppError(400, 'validation_error', 'Item-linked entries are purchased, not checked off');
    const updated = await prisma.shoppingListItem.update({
      where: { id: row.id }, data: { checkedOff, checkedOffAt: checkedOff ? new Date() : null },
    });
    return { data: rowDto(updated) };
  });

  s.delete<{ Params: { id: string } }>('/shopping-list-items/:id', async (req, reply) => {
    const row = await loadRow(req.household!.id, req.params.id);
    await prisma.shoppingListItem.delete({ where: { id: row.id } });
    return reply.code(204).send();
  });
}
```

Register in `scoped/index.ts`: `registerShoppingRoutes(s, deps);`.

- [ ] **Step 4: Run — expect pass; commit**

```bash
pnpm --filter @plantry/backend test && pnpm --filter @plantry/backend typecheck
git add -A && git commit -m "feat(backend): merged shopping list with tap-to-restock and next-trip entries"
```

---

### Task 12: Consolidate

**Files:**
- Modify: `apps/backend/src/services/items.ts`, `apps/backend/src/scoped/items.ts`
- Test: `apps/backend/src/services/consolidate.test.ts`

**Interfaces:**
- Consumes: `Db`, shared `consolidateSchema`.
- Produces: `consolidate(prisma: PrismaClient, args: { hid: string; targetId: string; sourceId: string; keepMinStockFrom: 'target' | 'source'; userSub: string }): Promise<void>`; route `POST /items/:targetId/consolidate`.

- [ ] **Step 1: Failing test**

`apps/backend/src/services/consolidate.test.ts` (after the boilerplate):
```ts
import { consolidate } from './items.js';
import { signedDelta } from './inventory.js';

describe('consolidate', () => {
  it('moves history, sums counts, inherits barcode, re-points list rows, archives source, audits', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const target = await ctx.item(hid, { name: 'Black beans', count: 2, min: 1 });
    const source = await ctx.item(hid, { name: 'Beans (black)', count: 3, min: 5, barcode: '555' });
    await ctx.call(u, 'POST', `${base}/shopping-list-items`, { itemId: source.id });

    const r = await ctx.call(u, 'POST', `${base}/items/${target.id}/consolidate`, { sourceId: source.id, keepMinStockFrom: 'source' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ id: target.id, currentCount: 5, minStock: 5, barcode: '555' });
    expect(r.body.data.nextTripRowId).not.toBeNull();

    const src = await ctx.prisma.item.findUniqueOrThrow({ where: { id: source.id }, include: { inventory: true } });
    expect(src.archivedAt).not.toBeNull();
    expect(src.barcode).toBeNull();
    expect(Number(src.inventory!.currentCount)).toBe(0);
    expect(await ctx.prisma.inventoryEvent.count({ where: { itemId: source.id } })).toBe(0);
    const events = await ctx.prisma.inventoryEvent.findMany({ where: { itemId: target.id } });
    expect(events.reduce((a, e) => a + signedDelta(e.eventType, Number(e.quantity)), 0)).toBe(5);
    expect(await ctx.prisma.itemMerge.count({ where: { sourceId: source.id, targetId: target.id } })).toBe(1);
  });

  it('rejects self-merge and archived participants', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const base = `/api/households/${hid}`;
    const a = await ctx.item(hid); const gone = await ctx.item(hid, { archived: true });
    expect((await ctx.call(u, 'POST', `${base}/items/${a.id}/consolidate`, { sourceId: a.id })).status).toBe(400);
    expect((await ctx.call(u, 'POST', `${base}/items/${a.id}/consolidate`, { sourceId: gone.id })).status).toBe(404);
  });

  it('is atomic: a failure at the last step leaves everything untouched', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const target = await ctx.item(hid, { count: 2 }); const source = await ctx.item(hid, { count: 3, barcode: '777' });
    // 'ghost' violates the item_merges.merged_by FK — the final statement of the transaction.
    await expect(consolidate(ctx.prisma, { hid, targetId: target.id, sourceId: source.id, keepMinStockFrom: 'target', userSub: 'ghost' }))
      .rejects.toThrow();
    const src = await ctx.prisma.item.findUniqueOrThrow({ where: { id: source.id }, include: { inventory: true } });
    expect(src.archivedAt).toBeNull();
    expect(src.barcode).toBe('777');
    expect(Number(src.inventory!.currentCount)).toBe(3);
    expect(await ctx.prisma.inventoryEvent.count({ where: { itemId: source.id } })).toBe(1);
  });
});
```

Run → FAIL.

- [ ] **Step 2: Implement**

Append to `apps/backend/src/services/items.ts` (add `import type { PrismaClient } from '@prisma/client';` and `import { AppError } from '../errors.js';`):
```ts
export interface ConsolidateArgs { hid: string; targetId: string; sourceId: string; keepMinStockFrom: 'target' | 'source'; userSub: string }

/** Spec §5.6. Non-destructive: the source is archived, never deleted. One transaction. */
export async function consolidate(prisma: PrismaClient, a: ConsolidateArgs): Promise<void> {
  if (a.targetId === a.sourceId) throw new AppError(400, 'validation_error', 'Cannot merge an item into itself');
  await prisma.$transaction(async (tx) => {
    const load = (id: string) => tx.item.findFirst({ where: { id, householdId: a.hid, archivedAt: null }, include: { inventory: true } });
    const [target, source] = await Promise.all([load(a.targetId), load(a.sourceId)]);
    if (!target || !source) throw notFound();

    await tx.inventoryEvent.updateMany({ where: { itemId: source.id }, data: { itemId: target.id } });

    const minStock = a.keepMinStockFrom === 'source' ? source.inventory!.minStock : target.inventory!.minStock;
    const tInv = await tx.inventory.update({
      where: { itemId: target.id },
      data: { currentCount: { increment: source.inventory!.currentCount }, minStock },
    });
    if (tInv.lastNotifiedAt && tInv.currentCount.gt(tInv.minStock)) {
      await tx.inventory.update({ where: { itemId: target.id }, data: { lastNotifiedAt: null } });
    }
    await tx.inventory.update({ where: { itemId: source.id }, data: { currentCount: 0 } });

    const targetHasRow = await tx.shoppingListItem.findFirst({ where: { itemId: target.id, checkedOff: false } });
    if (targetHasRow) await tx.shoppingListItem.deleteMany({ where: { itemId: source.id } });
    else await tx.shoppingListItem.updateMany({ where: { itemId: source.id }, data: { itemId: target.id, name: target.name } });

    await tx.item.update({
      where: { id: source.id },
      data: {
        barcode: null, archivedAt: new Date(), archivedBy: a.userSub,
        ...(!target.imageRef && source.imageRef ? { imageRef: null } : {}),
      },
    });
    await tx.item.update({
      where: { id: target.id },
      data: {
        ...(!target.barcode && source.barcode ? { barcode: source.barcode } : {}),
        ...(!target.imageRef && source.imageRef ? { imageRef: source.imageRef } : {}),
      },
    });
    await tx.itemMerge.create({ data: { sourceId: source.id, targetId: target.id, mergedBy: a.userSub } });
  });
}
```

In `apps/backend/src/scoped/items.ts` add imports `consolidateSchema` (shared), `consolidate` (services/items), `uuidParam`, and the route:
```ts
  s.post<{ Params: { targetId: string } }>('/items/:targetId/consolidate', async (req) => {
    const hid = req.household!.id;
    const b = parse(consolidateSchema, req.body);
    await consolidate(prisma, {
      hid, targetId: uuidParam(req.params.targetId), sourceId: b.sourceId,
      keepMinStockFrom: b.keepMinStockFrom, userSub: req.user!.sub,
    });
    return { data: await serializeItem(await loadItem(deps, hid, req.params.targetId), deps.storage) };
  });
```

- [ ] **Step 3: Run — expect pass; commit**

```bash
pnpm --filter @plantry/backend test
git add -A && git commit -m "feat(backend): atomic, non-destructive item consolidation"
```

---

### Task 13: Scoping matrix test

**Files:**
- Test: `apps/backend/src/scoped/scoping-matrix.test.ts`

**Interfaces:**
- Consumes: `app.routeTable`, every scoped route from Tasks 4–12. **Task 17 must add its three photo routes to `BODIES` in this file.**

- [ ] **Step 1: Write the test**

`apps/backend/src/scoped/scoping-matrix.test.ts` (after the boilerplate):
```ts
const PREFIX = '/api/households/:hid';

/** Valid bodies so that validation passes and the 404 must come from scoping. `A_ITEM` is replaced with an item in the caller's own household. */
const BODIES: Record<string, unknown> = {
  'PATCH /': { name: 'x' },
  'PATCH /members/:sub': { role: 'member' },
  'POST /stores': { name: 'x' },
  'PATCH /stores/:id': { name: 'x' },
  'POST /units': { name: 'x' },
  'PATCH /units/:id': { name: 'x' },
  'POST /items': { name: 'x', unitId: 'EACH' },
  'PATCH /items/:id': { name: 'x' },
  'POST /items/:targetId/consolidate': { sourceId: 'A_ITEM' },
  'POST /inventory/:itemId/restock': { quantity: 1 },
  'POST /inventory/:itemId/consume': { quantity: 1 },
  'POST /inventory/:itemId/adjust': { newCount: 1 },
  'POST /shopping-list-items': { name: 'x' },
  'PATCH /shopping-list-items/:id': { checkedOff: true },
  'POST /shopping-list/items/:itemId/purchase': {},
};
const QUERY: Record<string, string> = {
  'GET /items/consumption-rates': '?window=30d',
  'GET /items/:id/consumption-rate': '?window=30d',
};

describe('scoping matrix', () => {
  it('every scoped route 404s for non-members and for foreign resource ids', async () => {
    const caller = await ctx.user({ admin: true }); const bOwner = await ctx.user(); const bMember = await ctx.user();
    const A = await ctx.household(caller, 'A'); const B = await ctx.household(bOwner, 'B');
    await ctx.addMember(B, bMember);
    const aItem = await ctx.item(A);
    const each = await ctx.prisma.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });

    const bItem = await ctx.item(B, { count: 5, archived: false });
    const bStore = await ctx.prisma.store.create({ data: { householdId: B, name: 's' } });
    const bUnit = await ctx.prisma.unit.create({ data: { householdId: B, name: 'u' } });
    const bRow = await ctx.prisma.shoppingListItem.create({ data: { householdId: B, name: 'r' } });
    const bEvent = await ctx.prisma.inventoryEvent.findFirstOrThrow({ where: { itemId: bItem.id } });

    const foreignId = (suffix: string, param: string): string => {
      if (param === 'sub') return bMember.sub;
      if (param === 'eventId') return bEvent.id;
      if (param === 'itemId' || param === 'targetId') return bItem.id;
      if (suffix.startsWith('/stores')) return bStore.id;
      if (suffix.startsWith('/units')) return bUnit.id;
      if (suffix.startsWith('/shopping-list-items')) return bRow.id;
      return bItem.id; // /items/:id...
    };

    const scoped = ctx.app.routeTable.filter((r) => r.url.startsWith(PREFIX));
    expect(scoped.length).toBeGreaterThan(30);

    const failures: string[] = [];
    for (const r of scoped) {
      let suffix = r.url.slice(PREFIX.length) || '/';
      if (suffix.length > 1 && suffix.endsWith('/')) suffix = suffix.slice(0, -1);
      const key = `${r.method} ${suffix}`;
      const params = [...suffix.matchAll(/:(\w+)/g)].map((m) => m[1]!);
      const needsBody = ['POST', 'PATCH', 'PUT'].includes(r.method) && !/\/(archive|unarchive|invites)$/.test(suffix);
      if (needsBody && !(key in BODIES)) { failures.push(`${key}: add a body to BODIES`); continue; }
      const body = JSON.parse(JSON.stringify(BODIES[key] ?? null).replace('A_ITEM', aItem.id).replace('EACH', each.id));
      const path = params.reduce((p, name) => p.replace(`:${name}`, foreignId(suffix, name)), suffix === '/' ? '' : suffix);
      const send = (hid: string) => ctx.call(caller, r.method, `/api/households/${hid}${path}${QUERY[key] ?? ''}`, body ?? undefined);

      const nonMember = await send(B);
      if (nonMember.status !== 404) failures.push(`${key} as non-member → ${nonMember.status}`);
      if (params.length > 0) {
        const foreign = await send(A);
        if (foreign.status !== 404) failures.push(`${key} with foreign id → ${foreign.status}`);
      }
    }
    expect(failures).toEqual([]);

    // Nothing in B changed.
    expect(Number((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: bItem.id } })).currentCount)).toBe(5);
    expect(await ctx.prisma.householdMember.count({ where: { householdId: B } })).toBe(2);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @plantry/backend test src/scoped/scoping-matrix.test.ts`
Expected: PASS. If `failures` is non-empty, each line names a route that leaks — fix the **route** (load the resource with `householdId: hid` before anything else), never the test.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(backend): route-table-driven household scoping matrix"
```
