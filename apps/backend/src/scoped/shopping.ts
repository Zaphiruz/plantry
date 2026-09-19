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
