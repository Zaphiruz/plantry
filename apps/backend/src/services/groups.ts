import type { Prisma } from '@prisma/client';
import type { GroupDto } from '@plantry/shared';
import { num } from '../lib/num.js';

export const groupItemInclude = {
  items: { where: { archivedAt: null }, include: { inventory: true, unit: true } },
} satisfies Prisma.ItemGroupInclude;
export type GroupFull = Prisma.ItemGroupGetPayload<{ include: typeof groupItemInclude }>;

/**
 * Group low = SUM(current_count of ACTIVE, trackLow members) <= group.min_stock. An untracked
 * member doesn't count toward the sum (Brief A). A group with zero active tracked members is
 * never low. `memberIds` lists every active member regardless of trackLow — membership isn't
 * gated on it, only the low computation is.
 */
export function groupTotals(g: GroupFull): { total: number; low: boolean; memberIds: string[] } {
  const memberIds = g.items.map((i) => i.id);
  const tracked = g.items.filter((i) => i.trackLow);
  const total = tracked.reduce((sum, i) => sum + num(i.inventory!.currentCount), 0);
  const low = tracked.length > 0 && total <= num(g.minStock);
  return { total, low, memberIds };
}

export function serializeGroup(g: GroupFull): GroupDto {
  const { total, low, memberIds } = groupTotals(g);
  return {
    id: g.id, name: g.name, minStock: num(g.minStock), preferredStoreId: g.preferredStoreId,
    renotifyAfterDays: g.renotifyAfterDays, memberIds, total, low,
  };
}
