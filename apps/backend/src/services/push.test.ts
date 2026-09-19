import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestPrisma, resetDatabase } from '../test/helpers/db.js';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) } }));
const { createPushService } = await import('./push.js');

const prisma = getTestPrisma();
beforeEach(async () => {
  await resetDatabase();
  sendNotification.mockReset();
  await prisma.user.create({ data: { sub: 'u1', name: 'U', email: 'u@x', lastLoginAt: new Date() } });
  await prisma.pushSubscription.createMany({ data: [
    { endpoint: 'https://push/a', userSub: 'u1', p256dh: 'k', auth: 'a' },
    { endpoint: 'https://push/dead', userSub: 'u1', p256dh: 'k', auth: 'a' },
  ] });
});

describe('push service', () => {
  it('sends to every subscription and deletes the ones that are gone (404/410)', async () => {
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
    });
    const svc = createPushService(prisma, { publicKey: 'pk', privateKey: 'sk', subject: 'mailto:x@y.z' });
    const attempted = await svc.sendToUsers(['u1'], { title: 't', body: 'b', url: '/x' });
    expect(attempted).toBe(2);
    expect(JSON.parse(sendNotification.mock.calls[0]![1] as string)).toEqual({ title: 't', body: 'b', url: '/x' });
    expect((await prisma.pushSubscription.findMany()).map((s) => s.endpoint)).toEqual(['https://push/a']);
  });

  it('other errors are logged, not thrown, and keep the subscription', async () => {
    sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));
    const log = vi.fn();
    const svc = createPushService(prisma, { publicKey: 'pk', privateKey: 'sk', subject: 'mailto:x@y.z' }, log);
    await expect(svc.sendToUsers(['u1'], { title: 't', body: 'b', url: '/' })).resolves.toBe(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(await prisma.pushSubscription.count()).toBe(2);
  });
});
