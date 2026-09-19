import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import { AppError } from './errors.js';
import type { Deps } from './deps.js';

declare module 'fastify' {
  interface FastifyInstance {
    routeTable: { method: string; url: string }[];
  }
}

export interface BuildAppOptions {
  logger?: boolean;
  prisma: PrismaClient;
  frontendOrigin: string;
  sessionSecret: string;
  cookieSecure: boolean;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });
  const deps: Deps = { prisma: options.prisma, frontendOrigin: options.frontendOrigin };
  void deps; // consumed by route registration added in later tasks

  app.decorate('routeTable', []);
  app.addHook('onRoute', (r) => {
    for (const method of Array.isArray(r.method) ? r.method : [r.method]) {
      if (method !== 'HEAD') app.routeTable.push({ method, url: r.url });
    }
  });

  await app.register(cookie, { secret: options.sessionSecret });

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

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
}
