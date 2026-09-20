import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import { AppError } from './errors.js';
import type { Deps } from './deps.js';
import { makeRequireAdmin, makeRequireAuth } from './auth/middleware.js';
import { registerAuthRoutes, type AuthRouteDeps } from './auth/routes.js';
import { registerDevBypass } from './auth/dev-bypass.js';
import { createSessionStore } from './auth/session.js';
import type { OidcClient } from './auth/oidc.js';
import { registerHouseholdRoutes } from './households/routes.js';
import { registerInviteAcceptRoute } from './households/invites.js';
import { registerPushRoutes } from './routes/push.js';
import { registerFeedbackRoutes } from './routes/feedback.js';
import { registerScoped } from './scoped/index.js';
import type { PushService } from './services/push.js';
import type { Storage } from './services/storage.js';
import type { GithubClient } from './services/github.js';

declare module 'fastify' {
  interface FastifyInstance {
    routeTable: { method: string; url: string }[];
  }
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  prisma: PrismaClient;
  frontendOrigin: string;
  sessionSecret: string;
  cookieSecure: boolean;
  oidcClient: OidcClient;
  adminGroup?: string;
  sessionTtlSeconds?: number;
  devBypass?: boolean;
  disableRateLimit?: boolean;
  /** Number of proxy hops to trust for `req.ip`/`X-Forwarded-For`. 0 (default) trusts none. */
  trustProxyHops?: number;
  rateLimitMax?: number;
  push?: PushService;
  storage?: Storage;
  github?: GithubClient;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  // Trust exactly `trustProxyHops` hops in front of us when resolving `req.ip`.
  // 0 (the default, used by tests and dev) trusts nothing, so a client-supplied
  // X-Forwarded-For can never influence `req.ip`. NOTE: Fastify's own numeric
  // `trustProxy` is a documented no-op (fails closed), so we pass the hop-count
  // predicate that proxy-addr actually honours.
  const trustProxyHops = options.trustProxyHops ?? 0;
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: (_addr: string, hop: number) => hop < trustProxyHops,
  });
  const deps: Deps = {
    prisma: options.prisma, frontendOrigin: options.frontendOrigin,
    ...(options.push ? { push: options.push } : {}),
    ...(options.storage ? { storage: options.storage } : {}),
    ...(options.github ? { github: options.github } : {}),
  };

  app.decorate('routeTable', []);
  app.addHook('onRoute', (r) => {
    for (const method of Array.isArray(r.method) ? r.method : [r.method]) {
      if (method !== 'HEAD') app.routeTable.push({ method, url: r.url });
    }
  });

  await app.register(cookie, { secret: options.sessionSecret });

  const cookieName = 'plantry_sid';

  if (!options.disableRateLimit) {
    await app.register(rateLimit, {
      global: true,
      max: options.rateLimitMax ?? 600,
      timeWindow: '1 minute',
      allowList: (req) => req.url === '/health',
      // Bucket by peer address only: `plantry_sid` is an unsigned, client-supplied cookie value,
      // so keying on it lets a client mint a fresh bucket per request just by sending a new
      // cookie. `req.ip` only reflects X-Forwarded-For when trustProxyHops > 0, so it is
      // trustworthy here.
      keyGenerator: (req) => `ip:${req.ip}`,
    });
  }
  const ttlSeconds = options.sessionTtlSeconds ?? 7 * 24 * 60 * 60;
  const adminGroup = options.adminGroup ?? 'plantry-admins';
  const sessionStore = createSessionStore(options.prisma, ttlSeconds);
  app.decorate('requireAuth', makeRequireAuth({
    prisma: options.prisma, sessionStore, cookieName, cookieSecure: options.cookieSecure, ttlSeconds, adminGroup,
  }));
  app.decorate('requireAdmin', makeRequireAdmin());

  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method)) return;
    if (req.headers.origin !== options.frontendOrigin) throw new AppError(403, 'forbidden', 'Bad origin');
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
      });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: { code: 'validation_error', message: err.message } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal', message: 'Internal error' } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }),
  );

  // Cheap liveness: the process is up and serving.
  app.get('/health', async () => ({ status: 'ok' }));

  // Readiness: the process can actually reach its database.
  app.get('/api/ready', async (req, reply) => {
    try {
      await options.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (err) {
      req.log.error({ err }, 'readiness probe failed');
      return reply.code(503).send({ status: 'degraded' });
    }
  });

  const authDeps: AuthRouteDeps = {
    prisma: options.prisma, sessionStore, oidcClient: options.oidcClient, cookieName,
    cookieSecure: options.cookieSecure, ttlSeconds, frontendOrigin: options.frontendOrigin,
    photosEnabled: !!options.storage, pushEnabled: !!options.push, feedbackEnabled: !!options.github,
  };
  registerAuthRoutes(app, authDeps);
  if (options.devBypass) registerDevBypass(app, authDeps, adminGroup);

  registerHouseholdRoutes(app, deps);
  registerInviteAcceptRoute(app, deps);
  registerPushRoutes(app, deps);
  if (deps.github) registerFeedbackRoutes(app, { ...deps, github: deps.github });
  await registerScoped(app, deps);

  return app;
}
