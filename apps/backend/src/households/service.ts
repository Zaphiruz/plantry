import type { MemberRole, Prisma, PrismaClient } from '@prisma/client';
import { AppError, notFound } from '../errors.js';

const lastOwner = () => new AppError(409, 'last_owner', 'Assign another owner first');

// Serializes concurrent membership mutations on the same household so the
// "at least one owner" invariant can't be violated by a TOCTOU race between
// two transactions that each read the owner count before either commits.
async function lockHousehold(tx: Prisma.TransactionClient, hid: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM households WHERE id = ${hid}::uuid FOR UPDATE`;
}

export async function leaveHousehold(prisma: PrismaClient, hid: string, sub: string) {
  return prisma.$transaction(async (tx) => {
    await lockHousehold(tx, hid);
    const members = await tx.householdMember.findMany({ where: { householdId: hid } });
    const me = members.find((m) => m.userSub === sub);
    if (!me) throw notFound();
    if (members.length === 1) {
      const items = await tx.item.findMany({ where: { householdId: hid, imageRef: { not: null } }, select: { imageRef: true } });
      await tx.household.delete({ where: { id: hid } });
      return { householdDeleted: true, imageRefs: items.map((i) => i.imageRef!) };
    }
    if (me.role === 'owner' && members.filter((m) => m.role === 'owner').length === 1) throw lastOwner();
    await tx.householdMember.delete({ where: { householdId_userSub: { householdId: hid, userSub: sub } } });
    return { householdDeleted: false, imageRefs: [] as string[] };
  });
}

export async function removeMember(prisma: PrismaClient, hid: string, targetSub: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockHousehold(tx, hid);
    const members = await tx.householdMember.findMany({ where: { householdId: hid } });
    const target = members.find((m) => m.userSub === targetSub);
    if (!target) throw notFound();
    if (target.role === 'owner' && members.filter((m) => m.role === 'owner').length === 1) throw lastOwner();
    await tx.householdMember.delete({ where: { householdId_userSub: { householdId: hid, userSub: targetSub } } });
  });
}

export async function setRole(prisma: PrismaClient, hid: string, targetSub: string, role: MemberRole): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await lockHousehold(tx, hid);
    const members = await tx.householdMember.findMany({ where: { householdId: hid } });
    const target = members.find((m) => m.userSub === targetSub);
    if (!target) throw notFound();
    if (target.role === 'owner' && role === 'member' && members.filter((m) => m.role === 'owner').length === 1) {
      throw lastOwner();
    }
    await tx.householdMember.update({
      where: { householdId_userSub: { householdId: hid, userSub: targetSub } }, data: { role },
    });
  });
}
