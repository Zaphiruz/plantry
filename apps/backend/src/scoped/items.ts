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
