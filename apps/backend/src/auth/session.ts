import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

export interface SessionData { groups: string[]; idToken?: string }
export interface SessionRecord { userSub: string; data: SessionData; expiresAt: Date }
export interface SessionStore {
  create(userSub: string, data: SessionData): Promise<string>;
  get(sid: string): Promise<SessionRecord | null>;
  touch(sid: string): Promise<void>;
  destroy(sid: string): Promise<void>;
}

export const hashSid = (sid: string): string => createHash('sha256').update(sid).digest('hex');

export function createSessionStore(prisma: PrismaClient, ttlSeconds: number): SessionStore {
  const expiry = () => new Date(Date.now() + ttlSeconds * 1000);
  return {
    async create(userSub, data) {
      const sid = randomBytes(32).toString('base64url');
      await prisma.session.create({
        data: { idHash: hashSid(sid), userSub, data: data as unknown as Prisma.InputJsonValue, expiresAt: expiry() },
      });
      return sid;
    },
    async get(sid) {
      const row = await prisma.session.findUnique({ where: { idHash: hashSid(sid) } });
      if (!row) return null;
      if (row.expiresAt.getTime() <= Date.now()) {
        await prisma.session.deleteMany({ where: { idHash: row.idHash } });
        return null;
      }
      return { userSub: row.userSub, data: row.data as unknown as SessionData, expiresAt: row.expiresAt };
    },
    async touch(sid) {
      await prisma.session.updateMany({ where: { idHash: hashSid(sid) }, data: { expiresAt: expiry() } });
    },
    async destroy(sid) {
      await prisma.session.deleteMany({ where: { idHash: hashSid(sid) } });
    },
  };
}
