import type { PrismaClient } from '@prisma/client';
import { num } from '../lib/num.js';
import { lowItemsWhere } from '../scoped/inventory.js';
import { groupItemInclude, groupTotals, type GroupFull } from '../services/groups.js';
import type { PushService } from '../services/push.js';

const DAY_MS = 86_400_000;

// Same rounding as the frontend's formatQty, minus the unit label: a group's members can carry
// different units, so its total/min are shown as bare numbers rather than in any one unit.
const fmtNum = (n: number): string => String(Math.round(n * 1000) / 1000);

function groupDigestLine(g: GroupFull): string {
  const { total } = groupTotals(g);
  const trackedCount = g.items.filter((i) => i.trackLow).length;
  return `${g.name} (${trackedCount} item${trackedCount === 1 ? '' : 's'}, total ${fmtNum(total)} ≤ min ${fmtNum(num(g.minStock))})`;
}

export function digestBody(names: string[]): string {
  const n = names.length;
  const shown = names.slice(0, 2).join(', ');
  return `${n} item${n === 1 ? '' : 's'} low — ${shown}${n > 2 ? `, +${n - 2}` : ''}`;
}

/** Spec §5.4 — one digest per household per run; per-item re-notify cadence. */
export async function runLowStockDigest(
  prisma: PrismaClient, push: PushService | undefined, now: Date, log?: (err: unknown, msg: string) => void,
): Promise<{ households: number; items: number; failed: number }> {
  if (!push) return { households: 0, items: 0, failed: 0 };
  const households = await prisma.household.findMany({ include: { members: true } });
  let sentHouseholds = 0; let sentItems = 0; let failed = 0;
  for (const h of households) {
    try {
      const low = await prisma.item.findMany({ where: lowItemsWhere(prisma, h.id), include: { inventory: true }, orderBy: { name: 'asc' } });
      const due = low.filter((i) => {
        const last = i.inventory!.lastNotifiedAt;
        return !last || now.getTime() - last.getTime() >= i.renotifyAfterDays * DAY_MS;
      });
      const groups = (await prisma.itemGroup.findMany({ where: { householdId: h.id }, include: groupItemInclude, orderBy: { name: 'asc' } }))
        .filter((g) => groupTotals(g).low);
      const dueGroups = groups.filter((g) => !g.lastNotifiedAt || now.getTime() - g.lastNotifiedAt.getTime() >= g.renotifyAfterDays * DAY_MS);
      if (due.length === 0 && dueGroups.length === 0) continue;
      const names = [
        ...due.map((i) => i.name),
        ...dueGroups.map(groupDigestLine),
      ];
      const attempted = await push.sendToUsers(h.members.map((m) => m.userSub), {
        title: h.name, body: digestBody(names), url: `/h/${h.id}/shopping`,
      });
      if (attempted === 0) continue; // nobody subscribed yet — notify as soon as someone is
      if (due.length) await prisma.inventory.updateMany({ where: { itemId: { in: due.map((i) => i.id) } }, data: { lastNotifiedAt: now } });
      if (dueGroups.length) await prisma.itemGroup.updateMany({ where: { id: { in: dueGroups.map((g) => g.id) } }, data: { lastNotifiedAt: now } });
      sentHouseholds++; sentItems += due.length + dueGroups.length;
    } catch (err) {
      failed++;
      log?.(err, `low-stock digest failed for household ${h.id}`);
    }
  }
  return { households: sentHouseholds, items: sentItems, failed };
}
