import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { AppError, forbidden } from '../errors.js';
import type { SessionStore } from './session.js';

export interface RequestUser { sub: string; name: string; email: string; isAdmin: boolean }

declare module 'fastify' {
  interface FastifyRequest { user?: RequestUser }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface AuthMiddlewareDeps {
  prisma: PrismaClient;
  sessionStore: SessionStore;
  cookieName: string;
  cookieSecure: boolean;
  ttlSeconds: number;
  adminGroup: string;
}

const unauthorized = (m: string) => new AppError(401, 'unauthorized', m);

export function makeRequireAuth(deps: AuthMiddlewareDeps) {
  return async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const sid = req.cookies[deps.cookieName];
    if (!sid) throw unauthorized('No session');
    const session = await deps.sessionStore.get(sid);
    if (!session) throw unauthorized('Invalid session');
    const user = await deps.prisma.user.findUnique({ where: { sub: session.userSub } });
    if (!user) throw unauthorized('User not found');

    // Sliding expiry: once less than 6/7 of the TTL remains, extend DB row and cookie.
    const remainingMs = session.expiresAt.getTime() - Date.now();
    if (remainingMs < deps.ttlSeconds * 1000 * (6 / 7)) {
      await deps.sessionStore.touch(sid);
      reply.setCookie(deps.cookieName, sid, {
        path: '/', httpOnly: true, sameSite: 'lax', secure: deps.cookieSecure, maxAge: deps.ttlSeconds,
      });
    }
    req.user = {
      sub: user.sub, name: user.name, email: user.email,
      isAdmin: session.data.groups.includes(deps.adminGroup),
    };
  };
}

export function makeRequireAdmin() {
  return async function requireAdmin(req: FastifyRequest): Promise<void> {
    if (!req.user) throw unauthorized('No user');
    if (!req.user.isAdmin) throw forbidden('Admin required');
  };
}
