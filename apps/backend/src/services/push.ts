import webpush from 'web-push';
import type { PrismaClient } from '@prisma/client';

export interface PushPayload { title: string; body: string; url: string }
export interface PushService {
  publicKey: string;
  /** Sends synchronously (spec: fine at household scale). Returns how many subscriptions were attempted. */
  sendToUsers(userSubs: string[], payload: PushPayload): Promise<number>;
}
export interface PushConfig { publicKey: string; privateKey: string; subject: string }

export function createPushService(prisma: PrismaClient, cfg: PushConfig, log?: (err: unknown, msg: string) => void): PushService {
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return {
    publicKey: cfg.publicKey,
    async sendToUsers(userSubs, payload) {
      if (userSubs.length === 0) return 0;
      const subs = await prisma.pushSubscription.findMany({ where: { userSub: { in: userSubs } } });
      await Promise.all(subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
          } else {
            log?.(err, 'web-push send failed');
          }
        }
      }));
      return subs.length;
    },
  };
}
