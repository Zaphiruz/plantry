import type { FastifyInstance } from 'fastify';
import { pushSubscribeSchema, pushUnsubscribeSchema } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { parse } from '../errors.js';

export function registerPushRoutes(app: FastifyInstance, deps: Deps): void {
  const auth = { preHandler: app.requireAuth };

  app.get('/api/push/vapid-key', auth, async () => ({ data: { publicKey: deps.push?.publicKey ?? null } }));

  app.post('/api/push/subscriptions', auth, async (req, reply) => {
    const b = parse(pushSubscribeSchema, req.body);
    const data = { userSub: req.user!.sub, p256dh: b.keys.p256dh, auth: b.keys.auth };
    await deps.prisma.pushSubscription.upsert({ where: { endpoint: b.endpoint }, create: { endpoint: b.endpoint, ...data }, update: data });
    return reply.code(204).send();
  });

  app.delete('/api/push/subscriptions', auth, async (req, reply) => {
    const b = parse(pushUnsubscribeSchema, req.body);
    await deps.prisma.pushSubscription.deleteMany({ where: { endpoint: b.endpoint, userSub: req.user!.sub } });
    return reply.code(204).send();
  });
}
