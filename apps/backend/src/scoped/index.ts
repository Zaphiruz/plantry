import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { MemberRole } from '@prisma/client';
import type { Deps } from '../deps.js';
import { forbidden, notFound } from '../errors.js';
import { isUuid } from '../lib/ids.js';
import { registerMemberRoutes } from './members.js';
import { registerInviteCreateRoute } from '../households/invites.js';
import { registerStoreRoutes } from './stores.js';
import { registerUnitRoutes } from './units.js';
import { registerItemRoutes } from './items.js';
import { registerInventoryRoutes } from './inventory.js';
import { registerRateRoutes } from './rates.js';
import { registerShoppingRoutes } from './shopping.js';
import { registerPhotoRoutes } from './photos.js';

declare module 'fastify' {
  interface FastifyRequest { household?: { id: string; role: MemberRole } }
}

export function requireOwner(req: FastifyRequest): void {
  if (req.household?.role !== 'owner') throw forbidden('Owner required');
}

export async function registerScoped(app: FastifyInstance, deps: Deps): Promise<void> {
  await app.register(async (s) => {
    s.addHook('preHandler', app.requireAuth);
    s.addHook('preHandler', async (req) => {
      const hid = (req.params as { hid?: string }).hid;
      if (!isUuid(hid)) throw notFound();
      const m = await deps.prisma.householdMember.findUnique({
        where: { householdId_userSub: { householdId: hid, userSub: req.user!.sub } },
      });
      if (!m) throw notFound();
      req.household = { id: m.householdId, role: m.role };
    });

    registerMemberRoutes(s, deps);
    registerInviteCreateRoute(s, deps);
    registerStoreRoutes(s, deps);
    registerUnitRoutes(s, deps);
    registerRateRoutes(s, deps);
    registerItemRoutes(s, deps);
    registerInventoryRoutes(s, deps);
    registerShoppingRoutes(s, deps);
    registerPhotoRoutes(s, deps);
  }, { prefix: '/api/households/:hid' });
}
