import type { EventType, InventoryEvent, Prisma } from '@prisma/client';
import { AppError } from '../errors.js';

export type Db = Prisma.TransactionClient;

export function signedDelta(eventType: EventType, quantity: number): number {
  switch (eventType) {
    case 'restock': return quantity;
    case 'consume':
    case 'auto_deduct': return -quantity;
    case 'adjust': return quantity; // adjust stores a signed delta
  }
}

export interface ApplyEventInput {
  itemId: string;
  householdId: string;
  eventType: EventType;
  quantity: number;
  userSub: string | null;
  note?: string | null;
  now?: Date;
}

async function clearNotifiedIfRecovered(db: Db, itemId: string): Promise<void> {
  const inv = await db.inventory.findUniqueOrThrow({ where: { itemId } });
  if (inv.lastNotifiedAt && inv.currentCount.gt(inv.minStock)) {
    await db.inventory.update({ where: { itemId }, data: { lastNotifiedAt: null } });
  }
}

/** The ONLY writer of inventory_events and inventory.current_count. Call inside a transaction. */
export async function applyEvent(db: Db, input: ApplyEventInput): Promise<InventoryEvent> {
  if (input.eventType !== 'adjust' && !(input.quantity > 0)) {
    throw new AppError(400, 'validation_error', 'quantity must be > 0');
  }
  const now = input.now ?? new Date();
  const event = await db.inventoryEvent.create({
    data: {
      itemId: input.itemId, householdId: input.householdId, eventType: input.eventType,
      quantity: input.quantity, userSub: input.userSub, note: input.note ?? null, createdAt: now,
    },
  });
  await db.inventory.update({
    where: { itemId: input.itemId },
    data: {
      currentCount: { increment: signedDelta(input.eventType, input.quantity) },
      ...(input.eventType === 'restock' ? { lastRestockedAt: now } : {}),
    },
  });
  await clearNotifiedIfRecovered(db, input.itemId);
  return event;
}

export async function undoEvent(db: Db, event: InventoryEvent): Promise<void> {
  await db.inventoryEvent.delete({ where: { id: event.id } });
  await db.inventory.update({
    where: { itemId: event.itemId },
    data: { currentCount: { decrement: signedDelta(event.eventType, Number(event.quantity)) } },
  });
}
