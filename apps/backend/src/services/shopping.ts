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
