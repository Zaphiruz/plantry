import type { PrismaClient } from '@prisma/client';
import { lowItemsWhere } from '../scoped/inventory.js';
import type { PushService } from '../services/push.js';

const DAY_MS = 86_400_000;

export function digestBody(names: string[]): string {
  const n = names.length;
  const shown = names.slice(0, 2).join(', ');
  return `${n} item${n === 1 ? '' : 's'} low — ${shown}${n > 2 ? `, +${n - 2}` : ''}`;
}

/** Spec §5.4 — one digest per household per run; per-item re-notify cadence. */
export async function runLowStockDigest(
  prisma: PrismaClient, push: PushService | undefined, now: Date,
): Promise<{ households: number; items: number }> {
  if (!push) return { households: 0, items: 0 };
  const households = await prisma.household.findMany({ include: { members: true } });
  let sentHouseholds = 0; let sentItems = 0;
  for (const h of households) {
    const low = await prisma.item.findMany({ where: lowItemsWhere(prisma, h.id), include: { inventory: true }, orderBy: { name: 'asc' } });
    const due = low.filter((i) => {
      const last = i.inventory!.lastNotifiedAt;
      return !last || now.getTime() - last.getTime() >= i.renotifyAfterDays * DAY_MS;
    });
    if (due.length === 0) continue;
    const attempted = await push.sendToUsers(h.members.map((m) => m.userSub), {
      title: h.name, body: digestBody(due.map((i) => i.name)), url: `/h/${h.id}/shopping`,
    });
    if (attempted === 0) continue; // nobody subscribed yet — notify as soon as someone is
    await prisma.inventory.updateMany({ where: { itemId: { in: due.map((i) => i.id) } }, data: { lastNotifiedAt: now } });
    sentHouseholds++; sentItems += due.length;
  }
  return { households: sentHouseholds, items: sentItems };
}
