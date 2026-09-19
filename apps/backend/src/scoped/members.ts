import type { FastifyInstance } from 'fastify';
import { householdNameSchema, memberRoleSchema, type MemberDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { parse } from '../errors.js';
import { leaveHousehold, removeMember, setRole } from '../households/service.js';
import { requireOwner } from './index.js';

export function registerMemberRoutes(s: FastifyInstance, deps: Deps): void {
  s.patch('/', async (req) => {
    requireOwner(req);
    const { name } = parse(householdNameSchema, req.body);
    const h = await deps.prisma.household.update({ where: { id: req.household!.id }, data: { name } });
    return { data: { id: h.id, name: h.name, role: req.household!.role } };
  });

  s.get('/members', async (req) => {
    const rows = await deps.prisma.householdMember.findMany({
      where: { householdId: req.household!.id }, include: { user: true }, orderBy: { joinedAt: 'asc' },
    });
    const data: MemberDto[] = rows.map((m) => ({
      sub: m.userSub, name: m.user.name, email: m.user.email, role: m.role, joinedAt: m.joinedAt.toISOString(),
    }));
    return { data };
  });

  // NOTE: '/members/me' must be registered before '/members/:sub' reads clearly; find-my-way prefers static segments anyway.
  s.delete('/members/me', async (req, reply) => {
    await leaveHousehold(deps.prisma, req.household!.id, req.user!.sub);
    return reply.code(204).send();
  });

  s.patch<{ Params: { sub: string } }>('/members/:sub', async (req) => {
    requireOwner(req);
    const { role } = parse(memberRoleSchema, req.body);
    await setRole(deps.prisma, req.household!.id, req.params.sub, role);
    return { data: { sub: req.params.sub, role } };
  });

  s.delete<{ Params: { sub: string } }>('/members/:sub', async (req, reply) => {
    requireOwner(req);
    await removeMember(deps.prisma, req.household!.id, req.params.sub);
    return reply.code(204).send();
  });
}
