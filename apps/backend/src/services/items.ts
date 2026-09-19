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
