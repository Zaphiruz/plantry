import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestCtx } from '../test/helpers/test-app.js';
import { resetDatabase } from '../test/helpers/db.js';
import { applyEvent, signedDelta, undoEvent } from './inventory.js';

let ctx: TestCtx;
beforeAll(async () => { ctx = await createTestApp(); });
afterAll(async () => { await ctx.close(); });
beforeEach(resetDatabase);

async function sumOfEvents(itemId: string): Promise<number> {
  const events = await ctx.prisma.inventoryEvent.findMany({ where: { itemId } });
  return events.reduce((acc, e) => acc + signedDelta(e.eventType, Number(e.quantity)), 0);
}
const count = async (itemId: string) => Number((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId } })).currentCount);

describe('applyEvent', () => {
  it('keeps current_count equal to the signed sum of events', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.item(hid, { count: 10 });
    const run = (eventType: any, quantity: number) =>
      ctx.prisma.$transaction((tx) => applyEvent(tx, { itemId: item.id, householdId: hid, eventType, quantity, userSub: u.sub }));
    await run('consume', 3); await run('restock', 2.5); await run('auto_deduct', 12); await run('adjust', -1.25);
    expect(await count(item.id)).toBeCloseTo(-3.75, 3);      // negative is allowed
    expect(await sumOfEvents(item.id)).toBeCloseTo(-3.75, 3);
  });

  it('rejects non-positive quantities except for adjust', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u); const item = await ctx.item(hid);
    await expect(ctx.prisma.$transaction((tx) =>
      applyEvent(tx, { itemId: item.id, householdId: hid, eventType: 'consume', quantity: 0, userSub: u.sub }))).rejects.toThrow();
  });

  it('restock stamps last_restocked_at; rising above min clears last_notified_at', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.item(hid, { count: 1, min: 2 });
    await ctx.prisma.inventory.update({ where: { itemId: item.id }, data: { lastNotifiedAt: new Date() } });
    const run = (q: number) => ctx.prisma.$transaction((tx) =>
      applyEvent(tx, { itemId: item.id, householdId: hid, eventType: 'restock', quantity: q, userSub: u.sub }));
    await run(1); // 2 <= min 2 → still low → keep
    expect((await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } })).lastNotifiedAt).not.toBeNull();
    await run(1); // 3 > 2 → clear
    const inv = await ctx.prisma.inventory.findUniqueOrThrow({ where: { itemId: item.id } });
    expect(inv.lastNotifiedAt).toBeNull();
    expect(inv.lastRestockedAt).not.toBeNull();
  });

  it('restocking a grouped member clears the GROUP\'s last_notified_at once the total recovers', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const group = await ctx.group(hid, { name: 'Treats', minStock: 2 });
    const a = await ctx.item(hid, { count: 1, groupId: group.id });
    await ctx.item(hid, { count: 0, groupId: group.id });
    await ctx.prisma.itemGroup.update({ where: { id: group.id }, data: { lastNotifiedAt: new Date() } });

    const run = (q: number) => ctx.prisma.$transaction((tx) =>
      applyEvent(tx, { itemId: a.id, householdId: hid, eventType: 'restock', quantity: q, userSub: u.sub }));
    await run(0.5); // total 1.5 <= min 2 → still low → keep
    expect((await ctx.prisma.itemGroup.findUniqueOrThrow({ where: { id: group.id } })).lastNotifiedAt).not.toBeNull();
    await run(1); // total 2.5 > 2 → clear
    expect((await ctx.prisma.itemGroup.findUniqueOrThrow({ where: { id: group.id } })).lastNotifiedAt).toBeNull();
  });
});

describe('undoEvent', () => {
  it('deletes the event and reverses the count', async () => {
    const u = await ctx.user(); const hid = await ctx.household(u);
    const item = await ctx.item(hid, { count: 5 });
    const ev = await ctx.prisma.$transaction((tx) =>
      applyEvent(tx, { itemId: item.id, householdId: hid, eventType: 'consume', quantity: 2, userSub: u.sub }));
    await ctx.prisma.$transaction((tx) => undoEvent(tx, ev));
    expect(await count(item.id)).toBe(5);
    expect(await sumOfEvents(item.id)).toBe(5);
  });
});
