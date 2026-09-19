import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { HouseholdSummary, InviteDto } from '@plantry/shared';
import { hashSid } from '../auth/session.js';
import type { Deps } from '../deps.js';
import { AppError } from '../errors.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const invalid = () => new AppError(410, 'invite_invalid', 'This invite is no longer valid');

export function registerInviteCreateRoute(s: FastifyInstance, deps: Deps): void {
  s.post('/invites', async (req) => {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await deps.prisma.householdInvite.create({
      data: { tokenHash: hashSid(token), householdId: req.household!.id, createdBy: req.user!.sub, expiresAt },
    });
    const data: InviteDto = { url: `${deps.frontendOrigin}/invite/${token}`, expiresAt: expiresAt.toISOString() };
    return { data };
  });
}

// Exported (rather than kept inline in the route) so tests can invoke it directly
// against a Prisma client extension that forces genuine interleaving of two
// concurrent accepts of the same invite — see invites.test.ts.
export async function acceptInvite(prisma: PrismaClient, token: string, sub: string): Promise<HouseholdSummary> {
  return prisma.$transaction(async (tx): Promise<HouseholdSummary> => {
    const invite = await tx.householdInvite.findUnique({
      where: { tokenHash: hashSid(token) }, include: { household: true },
    });
    if (!invite || invite.expiresAt.getTime() <= Date.now()) throw invalid();
    const existing = await tx.householdMember.findUnique({
      where: { householdId_userSub: { householdId: invite.householdId, userSub: sub } },
    });
    if (existing) return { id: invite.householdId, name: invite.household.name, role: existing.role };
    if (invite.acceptedBy) throw invalid();
    // Atomically claim the invite before creating the membership row: the
    // conditional UPDATE takes the row lock, so a concurrent accept either
    // blocks until this commits (then re-checks acceptedBy: null and gets
    // count 0) or observes acceptedBy already set — either way it is
    // rejected instead of also creating a member.
    const claimed = await tx.householdInvite.updateMany({
      where: { id: invite.id, acceptedBy: null }, data: { acceptedBy: sub, acceptedAt: new Date() },
    });
    if (claimed.count !== 1) throw invalid();
    await tx.householdMember.create({ data: { householdId: invite.householdId, userSub: sub, role: 'member' } });
    return { id: invite.householdId, name: invite.household.name, role: 'member' };
  });
}

export function registerInviteAcceptRoute(app: FastifyInstance, deps: Deps): void {
  app.post<{ Params: { token: string } }>('/api/invites/:token/accept', { preHandler: app.requireAuth }, async (req) => {
    const data = await acceptInvite(deps.prisma, req.params.token, req.user!.sub);
    return { data };
  });
}
