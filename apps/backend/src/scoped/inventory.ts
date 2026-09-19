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
      const [inv] = await tx.$queryRaw<{ currentCount: Prisma.Decimal }[]>`
        SELECT current_count AS "currentCount" FROM inventory WHERE item_id = ${item.id}::uuid FOR UPDATE`;
      if (!inv) throw notFound();
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
