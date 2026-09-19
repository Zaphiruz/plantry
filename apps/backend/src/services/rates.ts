import { Prisma, type PrismaClient } from '@prisma/client';
import { windowDays, type RateDto, type RateWindow } from '@plantry/shared';

const DAY_MS = 86_400_000;

/** Derived on every call — never stored (spec §5.3). */
export async function consumptionRates(
  prisma: PrismaClient, hid: string, window: RateWindow, opts: { itemId?: string; now?: Date } = {},
): Promise<RateDto[]> {
  const now = opts.now ?? new Date();
  const wDays = windowDays(window);
  const since = new Date(now.getTime() - wDays * DAY_MS);
  const itemFilter = opts.itemId ? Prisma.sql`AND i.id = ${opts.itemId}::uuid` : Prisma.empty;

  const rows = await prisma.$queryRaw<{ item_id: string; total: Prisma.Decimal | null; first_at: Date | null }[]>`
    SELECT i.id AS item_id,
           (SELECT SUM(e.quantity) FROM inventory_events e
             WHERE e.item_id = i.id AND e.event_type::text IN ('consume', 'auto_deduct')
               AND e.created_at >= ${since} AND e.created_at <= ${now}) AS total,
           (SELECT MIN(e.created_at) FROM inventory_events e WHERE e.item_id = i.id) AS first_at
    FROM items i
    WHERE i.household_id = ${hid}::uuid AND i.archived_at IS NULL ${itemFilter}
    ORDER BY i.name`;

  return rows.map((r) => {
    const ageDays = r.first_at ? (now.getTime() - r.first_at.getTime()) / DAY_MS : wDays;
    const days = Math.max(1, Math.min(wDays, ageDays));
    const total = r.total ? Number(r.total) : 0;
    return { itemId: r.item_id, window, avgPerDay: Math.round((total / days) * 10_000) / 10_000, days };
  });
}
