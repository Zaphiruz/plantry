import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { MeDto } from '@plantry/shared';
import { AppError } from '../errors.js';
import type { OidcClient } from './oidc.js';
import type { SessionStore } from './session.js';

export interface AuthRouteDeps {
  prisma: PrismaClient;
  sessionStore: SessionStore;
  oidcClient: OidcClient;
  cookieName: string;
  cookieSecure: boolean;
  ttlSeconds: number;
  frontendOrigin: string;
  photosEnabled: boolean;
  pushEnabled: boolean;
}

interface PkcePayload { state: string; nonce: string; codeVerifier: string }
const PKCE_COOKIE = 'plantry_oidc';
const bad = (m: string) => new AppError(400, 'validation_error', m);

const encode = (p: PkcePayload) => Buffer.from(JSON.stringify(p), 'utf8').toString('base64url');
function decode(v: string): PkcePayload | null {
  try {
    const p = JSON.parse(Buffer.from(v, 'base64url').toString('utf8')) as PkcePayload;
    return typeof p.state === 'string' && typeof p.nonce === 'string' && typeof p.codeVerifier === 'string' ? p : null;
  } catch { return null; }
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const limit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/auth/login', limit, async (_req, reply) => {
    const a = await deps.oidcClient.authorizationUrl();
    reply.setCookie(PKCE_COOKIE, encode({ state: a.state, nonce: a.nonce, codeVerifier: a.codeVerifier }), {
      path: '/api/auth', httpOnly: true, sameSite: 'lax', secure: deps.cookieSecure, signed: true, maxAge: 600,
    });
    return reply.redirect(a.url);
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/auth/callback', limit, async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) throw bad(`Provider returned: ${error}`);
      if (!code || !state) throw bad('Missing code or state');
      const raw = req.cookies[PKCE_COOKIE];
      const unsigned = raw ? req.unsignCookie(raw) : null;
      const payload = unsigned?.valid && unsigned.value ? decode(unsigned.value) : null;
      if (!payload || payload.state !== state) throw bad('State mismatch');

      let info;
      try {
        info = await deps.oidcClient.exchange({ code, state, nonce: payload.nonce, codeVerifier: payload.codeVerifier });
      } catch (err) {
        req.log.error({ err }, 'oidc exchange failed');
        throw bad('Token exchange failed');
      }
      const name = info.name?.trim() || info.preferred_username?.trim() || info.email || info.sub;
      await deps.prisma.user.upsert({
        where: { sub: info.sub },
        create: { sub: info.sub, name, email: info.email, lastLoginAt: new Date() },
        update: { name, email: info.email, lastLoginAt: new Date() },
      });
      reply.clearCookie(PKCE_COOKIE, { path: '/api/auth' });
      const sid = await deps.sessionStore.create(info.sub, {
        groups: info.groups, ...(info.idToken ? { idToken: info.idToken } : {}),
      });
      reply.setCookie(deps.cookieName, sid, {
        path: '/', httpOnly: true, sameSite: 'lax', secure: deps.cookieSecure, maxAge: deps.ttlSeconds,
      });
      return reply.redirect(`${deps.frontendOrigin}/`);
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const sid = req.cookies[deps.cookieName];
    let idTokenHint: string | undefined;
    if (sid) {
      idTokenHint = (await deps.sessionStore.get(sid))?.data.idToken;
      await deps.sessionStore.destroy(sid);
    }
    reply.clearCookie(deps.cookieName, { path: '/' });
    const endSessionUrl = deps.oidcClient.endSessionUrl
      ? await deps.oidcClient.endSessionUrl({
          postLogoutRedirectUri: deps.frontendOrigin, ...(idTokenHint ? { idTokenHint } : {}),
        })
      : null;
    return { data: { ok: true, endSessionUrl } };
  });

  app.get('/api/me', { preHandler: app.requireAuth }, async (req) => {
    const memberships = await deps.prisma.householdMember.findMany({
      where: { userSub: req.user!.sub }, include: { household: true }, orderBy: { joinedAt: 'asc' },
    });
    const data: MeDto = {
      user: req.user!,
      households: memberships.map((m) => ({ id: m.householdId, name: m.household.name, role: m.role })),
      photosEnabled: deps.photosEnabled,
      pushEnabled: deps.pushEnabled,
    };
    return { data };
  });
}
