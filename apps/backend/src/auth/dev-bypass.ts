import type { FastifyInstance } from 'fastify';
import type { AuthRouteDeps } from './routes.js';

/** Local dev + Playwright only. server.ts refuses to enable this when NODE_ENV=production. */
export function registerDevBypass(app: FastifyInstance, deps: AuthRouteDeps, adminGroup: string): void {
  app.get<{ Querystring: { sub?: string; name?: string; admin?: string } }>('/api/auth/dev-login', async (req, reply) => {
    const sub = req.query.sub ?? 'dev-user';
    const name = req.query.name ?? 'Dev User';
    await deps.prisma.user.upsert({
      where: { sub },
      create: { sub, name, email: `${sub}@dev.local`, lastLoginAt: new Date() },
      update: { name, lastLoginAt: new Date() },
    });
    const sid = await deps.sessionStore.create(sub, { groups: req.query.admin === '1' ? [adminGroup] : [] });
    reply.setCookie(deps.cookieName, sid, { path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: deps.ttlSeconds });
    return reply.redirect(`${deps.frontendOrigin}/`);
  });
}
