import type { PrismaClient } from '@prisma/client';
import { applyEvent } from '../services/inventory.js';

const DAY_MS = 86_400_000;

/**
 * Spec §5.2 — amount per period, whole periods only, anchor advances by whole periods so remainders carry.
 *
 * Concurrency: a user PATCH could reset lastAutoDeductAt between our read and our write. We claim the
 * anchor with a conditional `updateMany` (matching the anchor value we read) inside the transaction and
 * only write the deduction event if that claim succeeds (count === 1); otherwise we skip this item for
 * this run rather than deduct against a stale anchor.
 */
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
      const newAnchor = new Date(anchor.getTime() + periods * periodMs);
      const claimed = await prisma.$transaction(async (tx) => {
        const claim = await tx.inventory.updateMany({
          where: { itemId: item.id, lastAutoDeductAt: anchor },
          data: { lastAutoDeductAt: newAnchor },
        });
        if (claim.count === 0) return false; // anchor changed underneath us; skip this run
        await applyEvent(tx, { itemId: item.id, householdId: item.householdId, eventType: 'auto_deduct', quantity, userSub: null, now });
        return true;
      });
      if (claimed) deducted++;
    } catch (err) {
      failed++;
      log?.(err, `auto-deduct failed for item ${item.id}`);
    }
  }
  return { deducted, failed };
}
