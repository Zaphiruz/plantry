import type { Prisma, PrismaClient } from '@prisma/client';
import type { ItemDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, notFound } from '../errors.js';
import { uuidParam } from '../lib/ids.js';
import { num, numOrNull } from '../lib/num.js';
import { toUnitDto } from '../scoped/units.js';
import { GET_TTL_SECONDS, thumbKeyOf, type Storage } from './storage.js';

export const itemInclude = {
  inventory: true,
  unit: true,
  preferredStore: true,
  listRows: { where: { checkedOff: false }, select: { id: true } },
  barcodes: { select: { code: true } },
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
    unit: toUnitDto(i.unit), preferredStoreId: i.preferredStoreId, barcodes: i.barcodes.map((b) => b.code).sort(),
    renotifyAfterDays: i.renotifyAfterDays, defaultRestockQty: num(i.defaultRestockQty),
    autoDeductQty: numOrNull(i.autoDeductQty), autoDeductPeriodDays: i.autoDeductPeriodDays,
    autoDeductPaused: i.autoDeductPaused,
    archivedAt: i.archivedAt?.toISOString() ?? null,
    currentCount, minStock, low: currentCount <= minStock, trackLow: i.trackLow,
    nagging: currentCount <= minStock && i.trackLow,
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

export interface ConsolidateArgs { hid: string; targetId: string; sourceId: string; keepMinStockFrom: 'target' | 'source'; userSub: string }

/** Spec §5.6. Non-destructive: the source is archived, never deleted. One transaction. */
export async function consolidate(prisma: PrismaClient, rawArgs: ConsolidateArgs): Promise<void> {
  // UUIDs validate case-insensitively (uuidParam's regex, zod's .uuid()); normalize so a
  // same-item-different-casing pair can't slip past the self-merge guard below.
  const a = { ...rawArgs, targetId: rawArgs.targetId.toLowerCase(), sourceId: rawArgs.sourceId.toLowerCase() };
  if (a.targetId === a.sourceId) throw new AppError(400, 'validation_error', 'Cannot merge an item into itself');
  await prisma.$transaction(async (tx) => {
    // Load (household-scoped, not archived) BEFORE taking any lock, so a caller can't lock
    // another household's inventory row by naming an id outside their household.
    const load = (id: string) => tx.item.findFirst({ where: { id, householdId: a.hid, archivedAt: null } });
    const [target, source] = await Promise.all([load(a.targetId), load(a.sourceId)]);
    if (!target || !source) throw notFound();
    // Defense in depth: even if two different-cased ids somehow resolved to the same row.
    if (target.id === source.id) throw new AppError(400, 'validation_error', 'Cannot merge an item into itself');

    // Lock both inventory rows FOR UPDATE, in a deterministic order, before reading their
    // values — avoids deadlock/races with a concurrent consolidate or restock touching either row.
    const [id1, id2] = [target.id, source.id].sort();

    // Also lock the items rows themselves (same order) and re-confirm both are still active.
    // `target`/`source` above were loaded before any lock was taken, so a concurrent archive()
    // could have archived either one in between — without this, the barcode move below could
    // leave an archived item holding an ACTIVE barcode row.
    const stillActive = new Set((await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM items WHERE id IN (${id1}::uuid, ${id2}::uuid) AND archived_at IS NULL FOR UPDATE
    `).map((r) => r.id));
    if (!stillActive.has(target.id) || !stillActive.has(source.id)) throw notFound();

    const locked = await tx.$queryRaw<{ item_id: string; current_count: Prisma.Decimal; min_stock: Prisma.Decimal }[]>`
      SELECT item_id, current_count, min_stock FROM inventory WHERE item_id IN (${id1}::uuid, ${id2}::uuid) ORDER BY item_id FOR UPDATE
    `;
    const invById = new Map(locked.map((r) => [r.item_id, r]));
    const targetInv = invById.get(target.id);
    const sourceInv = invById.get(source.id);
    if (!targetInv || !sourceInv) throw notFound();

    await tx.inventoryEvent.updateMany({ where: { itemId: source.id }, data: { itemId: target.id } });

    const minStock = a.keepMinStockFrom === 'source' ? sourceInv.min_stock : targetInv.min_stock;
    const tInv = await tx.inventory.update({
      where: { itemId: target.id },
      data: { currentCount: { increment: sourceInv.current_count }, minStock },
    });
    if (tInv.lastNotifiedAt && tInv.currentCount.gt(tInv.minStock)) {
      await tx.inventory.update({ where: { itemId: target.id }, data: { lastNotifiedAt: null } });
    }
    await tx.inventory.update({ where: { itemId: source.id }, data: { currentCount: 0 } });

    const targetHasRow = await tx.shoppingListItem.findFirst({ where: { itemId: target.id, checkedOff: false } });
    if (targetHasRow) await tx.shoppingListItem.deleteMany({ where: { itemId: source.id, checkedOff: false } });
    else await tx.shoppingListItem.updateMany({ where: { itemId: source.id, checkedOff: false }, data: { itemId: target.id, name: target.name } });

    // The source's barcodes move to the target; codes the target already holds are dropped
    // silently (the partial unique index would otherwise reject the move).
    const sourceCodes = await tx.itemBarcode.findMany({ where: { itemId: source.id } });
    const targetCodeSet = new Set((await tx.itemBarcode.findMany({ where: { itemId: target.id }, select: { code: true } })).map((c) => c.code));
    const toDrop = sourceCodes.filter((c) => targetCodeSet.has(c.code)).map((c) => c.id);
    const toMove = sourceCodes.filter((c) => !targetCodeSet.has(c.code)).map((c) => c.id);
    if (toDrop.length) await tx.itemBarcode.deleteMany({ where: { id: { in: toDrop } } });
    if (toMove.length) await tx.itemBarcode.updateMany({ where: { id: { in: toMove } }, data: { itemId: target.id, archived: false } });

    await tx.item.update({
      where: { id: source.id },
      data: {
        archivedAt: new Date(), archivedBy: a.userSub,
        ...(!target.imageRef && source.imageRef ? { imageRef: null } : {}),
      },
    });
    await tx.item.update({
      where: { id: target.id },
      data: {
        ...(!target.imageRef && source.imageRef ? { imageRef: source.imageRef } : {}),
      },
    });
    await tx.itemMerge.create({ data: { sourceId: source.id, targetId: target.id, mergedBy: a.userSub } });
  });
}
