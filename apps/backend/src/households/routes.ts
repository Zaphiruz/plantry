import type { FastifyInstance } from 'fastify';
import { householdNameSchema, type HouseholdSummary } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { parse } from '../errors.js';

export function registerHouseholdRoutes(app: FastifyInstance, deps: Deps): void {
  app.post('/api/households', { preHandler: app.requireAuth }, async (req) => {
    const { name } = parse(householdNameSchema, req.body);
    const h = await deps.prisma.household.create({
      data: { name, members: { create: { userSub: req.user!.sub, role: 'owner' } } },
    });
    const data: HouseholdSummary = { id: h.id, name: h.name, role: 'owner' };
    return { data };
  });
}
