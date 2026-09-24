import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { consolidateSchema, itemCreateSchema, itemUpdateSchema } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, notFound, parse } from '../errors.js';
import { uuidParam } from '../lib/ids.js';
import { applyEvent } from '../services/inventory.js';
import { consolidate, itemInclude, loadItem, serializeItem } from '../services/items.js';
import { thumbKeyOf } from '../services/storage.js';

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const barcodeConflict = (code?: string) => new AppError(409, 'barcode_conflict', 'Another active item already uses this barcode', code ? { code } : undefined);
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Which of `codes` is already held by another active item in this household. Pre-checked
 * (rather than relying solely on the P2002 catch) so a 409 can report exactly which code clashed.
 */
async function findClashingCode(tx: Tx, hid: string, codes: string[], exceptItemId?: string): Promise<string | undefined> {
  if (codes.length === 0) return undefined;
  const clash = await tx.itemBarcode.findFirst({
    where: { householdId: hid, code: { in: codes }, archived: false, ...(exceptItemId ? { itemId: { not: exceptItemId } } : {}) },
  });
  return clash?.code;
}

/**
 * Locks the item row (`SELECT ... FOR UPDATE`) and confirms it is still active, inside the
 * caller's transaction. Guards against archive() racing in between `loadItem` (taken before the
 * transaction opens) and a write that would otherwise leave an archived item holding an ACTIVE
 * barcode row.
 */
export async function lockActiveItem(tx: Tx, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM items WHERE id = ${id}::uuid AND archived_at IS NULL FOR UPDATE`;
  if (rows.length === 0) throw notFound();
}

/** Replace-semantics sync of an item's barcodes, inside the caller's transaction. */
export async function syncBarcodes(tx: Tx, hid: string, itemId: string, codes: string[]): Promise<void> {
  const existing = await tx.itemBarcode.findMany({ where: { itemId }, select: { id: true, code: true } });
  const existingCodes = new Set(existing.map((r) => r.code));
  const wanted = new Set(codes);
  const toDeleteIds = existing.filter((r) => !wanted.has(r.code)).map((r) => r.id);
  const toInsert = codes.filter((c) => !existingCodes.has(c));
  if (toDeleteIds.length) await tx.itemBarcode.deleteMany({ where: { id: { in: toDeleteIds } } });
  if (toInsert.length) {
    await tx.itemBarcode.createMany({ data: toInsert.map((code) => ({ itemId, householdId: hid, code, archived: false })) });
  }
}

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

  s.get<{ Querystring: { q?: string; barcode?: string; archived?: string } }>('/items', async (req) => {
    const { q, barcode, archived } = req.query;
    const items = await prisma.item.findMany({
      where: {
        householdId: req.household!.id,
        archivedAt: archived === 'true' ? { not: null } : null,
        ...(barcode ? { barcodes: { some: { code: barcode, archived: false } } } : {}),
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
    try {
      const id = await prisma.$transaction(async (tx) => {
        const clash = await findClashingCode(tx, hid, b.barcodes);
        if (clash) throw barcodeConflict(clash);
        const item = await tx.item.create({
          data: {
            householdId: hid, name: b.name, description: b.description ?? null, category: b.category ?? null,
            unitId: b.unitId, preferredStoreId: b.preferredStoreId ?? null,
            renotifyAfterDays: b.renotifyAfterDays, defaultRestockQty: b.defaultRestockQty,
            autoDeductQty: b.autoDeductQty ?? null, autoDeductPeriodDays: b.autoDeductPeriodDays,
            autoDeductPaused: b.autoDeductPaused,
            inventory: { create: { minStock: b.minStock, lastAutoDeductAt: b.autoDeductQty ? new Date() : null } },
            barcodes: { create: b.barcodes.map((code) => ({ householdId: hid, code, archived: false })) },
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
      if (isUniqueViolation(e)) throw barcodeConflict(await findClashingCode(prisma, hid, b.barcodes));
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

    const { minStock, barcodes, ...itemFields } = b;
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
        if (barcodes !== undefined) {
          await lockActiveItem(tx, existing.id);
          const clash = await findClashingCode(tx, hid, barcodes, existing.id);
          if (clash) throw barcodeConflict(clash);
          await syncBarcodes(tx, hid, existing.id, barcodes);
        }
        await tx.item.update({ where: { id: existing.id }, data: itemFields });
        await tx.inventory.update({
          where: { itemId: existing.id },
          data: { ...(minStock !== undefined ? { minStock } : {}), ...anchorUpdate },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw barcodeConflict(barcodes !== undefined ? await findClashingCode(prisma, hid, barcodes, existing.id) : undefined);
      throw e;
    }
    return { data: await serializeItem(await loadItem(deps, hid, existing.id), deps.storage) };
  });

  s.post<{ Params: { id: string } }>('/items/:id/archive', async (req) => {
    const hid = req.household!.id;
    const item = await loadItem(deps, hid, req.params.id);
    await prisma.$transaction([
      prisma.item.update({ where: { id: item.id }, data: { archivedAt: new Date(), archivedBy: req.user!.sub } }),
      prisma.itemBarcode.updateMany({ where: { itemId: item.id }, data: { archived: true } }),
      prisma.shoppingListItem.deleteMany({ where: { itemId: item.id } }),
    ]);
    return { data: await serializeItem(await loadItem(deps, hid, item.id, { allowArchived: true }), deps.storage) };
  });

  s.post<{ Params: { id: string } }>('/items/:id/unarchive', async (req) => {
    const hid = req.household!.id;
    const item = await loadItem(deps, hid, req.params.id, { allowArchived: true });
    try {
      await prisma.$transaction(async (tx) => {
        const codes = (await tx.itemBarcode.findMany({ where: { itemId: item.id }, select: { code: true } })).map((c) => c.code);
        const clash = await findClashingCode(tx, hid, codes, item.id);
        if (clash) throw barcodeConflict(clash);
        await tx.item.update({ where: { id: item.id }, data: { archivedAt: null, archivedBy: null } });
        await tx.itemBarcode.updateMany({ where: { itemId: item.id }, data: { archived: false } });
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const codes = (await prisma.itemBarcode.findMany({ where: { itemId: item.id }, select: { code: true } })).map((c) => c.code);
        throw barcodeConflict(await findClashingCode(prisma, hid, codes, item.id));
      }
      throw e;
    }
    return { data: await serializeItem(await loadItem(deps, hid, item.id), deps.storage) };
  });

  s.post<{ Params: { targetId: string } }>('/items/:targetId/consolidate', async (req) => {
    const hid = req.household!.id;
    const b = parse(consolidateSchema, req.body);
    await consolidate(prisma, {
      hid, targetId: uuidParam(req.params.targetId), sourceId: b.sourceId,
      keepMinStockFrom: b.keepMinStockFrom, userSub: req.user!.sub,
    });
    return { data: await serializeItem(await loadItem(deps, hid, req.params.targetId), deps.storage) };
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
