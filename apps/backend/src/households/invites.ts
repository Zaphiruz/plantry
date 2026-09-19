import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
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

export function registerInviteAcceptRoute(app: FastifyInstance, deps: Deps): void {
  app.post<{ Params: { token: string } }>('/api/invites/:token/accept', { preHandler: app.requireAuth }, async (req) => {
    const sub = req.user!.sub;
    const data = await deps.prisma.$transaction(async (tx): Promise<HouseholdSummary> => {
      const invite = await tx.householdInvite.findUnique({
        where: { tokenHash: hashSid(req.params.token) }, include: { household: true },
      });
      if (!invite || invite.expiresAt.getTime() <= Date.now()) throw invalid();
      const existing = await tx.householdMember.findUnique({
        where: { householdId_userSub: { householdId: invite.householdId, userSub: sub } },
      });
      if (existing) return { id: invite.householdId, name: invite.household.name, role: existing.role };
      if (invite.acceptedBy) throw invalid();
      await tx.householdMember.create({ data: { householdId: invite.householdId, userSub: sub, role: 'member' } });
      await tx.householdInvite.update({ where: { id: invite.id }, data: { acceptedBy: sub, acceptedAt: new Date() } });
      return { id: invite.householdId, name: invite.household.name, role: 'member' };
    });
    return { data };
  });
}
