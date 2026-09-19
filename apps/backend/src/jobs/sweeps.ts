import type { PrismaClient } from '@prisma/client';
import { thumbKeyOf, type Storage } from '../services/storage.js';

const DAY_MS = 86_400_000;

export async function runSweeps(prisma: PrismaClient, storage: Storage | undefined, now: Date): Promise<void> {
  await prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  await prisma.householdInvite.deleteMany({
    where: { OR: [{ expiresAt: { lte: now } }, { acceptedAt: { lte: new Date(now.getTime() - 30 * DAY_MS) } }] },
  });
  await prisma.shoppingListItem.deleteMany({
    where: { itemId: null, checkedOff: true, checkedOffAt: { lte: new Date(now.getTime() - DAY_MS) } },
  });

  if (!storage) return;
  const refs = await prisma.item.findMany({ where: { imageRef: { not: null } }, select: { imageRef: true } });
  const live = new Set(refs.flatMap((r) => [r.imageRef!, thumbKeyOf(r.imageRef!)]));
  const cutoff = now.getTime() - DAY_MS; // leave in-flight uploads alone
  const orphans = (await storage.list('h/')).filter((o) => !live.has(o.key) && o.lastModified.getTime() <= cutoff).map((o) => o.key);
  await storage.remove(orphans);
}
