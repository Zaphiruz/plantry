import { PrismaClient } from '@prisma/client';

let client: PrismaClient | undefined;
export function getTestPrisma(): PrismaClient {
  client ??= new PrismaClient();
  return client;
}

/** Row-wise deletes (NOT TRUNCATE ... CASCADE, which would wipe the seeded global units). */
export async function resetDatabase(): Promise<void> {
  const p = getTestPrisma();
  await p.household.deleteMany();
  await p.unit.deleteMany({ where: { householdId: { not: null } } });
  await p.pushSubscription.deleteMany();
  await p.session.deleteMany();
  await p.user.deleteMany();
  await p.jobRun.deleteMany();
}
