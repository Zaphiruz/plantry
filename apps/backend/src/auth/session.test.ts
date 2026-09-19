import { beforeEach, describe, expect, it } from 'vitest';
import { getTestPrisma, resetDatabase } from '../test/helpers/db.js';
import { createSessionStore, hashSid } from './session.js';

const prisma = getTestPrisma();
beforeEach(async () => {
  await resetDatabase();
  await prisma.user.create({ data: { sub: 'u1', name: 'U', email: 'u@x', lastLoginAt: new Date() } });
});

describe('session store', () => {
  it('creates, reads and destroys; stores only the hash', async () => {
    const store = createSessionStore(prisma, 3600);
    const sid = await store.create('u1', { groups: ['plantry-admins'] });
    expect(sid.length).toBeGreaterThanOrEqual(43);
    expect(await prisma.session.findUnique({ where: { idHash: sid } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { idHash: hashSid(sid) } })).not.toBeNull();
    expect((await store.get(sid))?.data.groups).toEqual(['plantry-admins']);
    await store.destroy(sid);
    expect(await store.get(sid)).toBeNull();
  });

  it('treats expired sessions as missing and deletes them', async () => {
    const store = createSessionStore(prisma, -1);
    const sid = await store.create('u1', { groups: [] });
    expect(await store.get(sid)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it('touch slides the expiry forward', async () => {
    const store = createSessionStore(prisma, 3600);
    const sid = await store.create('u1', { groups: [] });
    await prisma.session.update({ where: { idHash: hashSid(sid) }, data: { expiresAt: new Date(Date.now() + 1000) } });
    await store.touch(sid);
    const s = await store.get(sid);
    expect(s!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3000_000);
  });
});
