import type { FastifyInstance } from 'fastify';
import { groupCreateSchema, groupUpdateSchema } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, notFound, parse } from '../errors.js';
import { uuidParam } from '../lib/ids.js';
import { groupItemInclude, serializeGroup } from '../services/groups.js';

export function registerGroupRoutes(s: FastifyInstance, deps: Deps): void {
  const { prisma } = deps;

  async function assertStore(hid: string, storeId?: string | null): Promise<void> {
    if (storeId) {
      const ok = await prisma.store.findFirst({ where: { id: storeId, householdId: hid } });
      if (!ok) throw new AppError(400, 'validation_error', 'Unknown store');
    }
  }

  const load = async (hid: string, id: unknown) => {
    const row = await prisma.itemGroup.findFirst({ where: { id: uuidParam(id), householdId: hid }, include: groupItemInclude });
    if (!row) throw notFound();
    return row;
  };

  s.get('/groups', async (req) => {
    const rows = await prisma.itemGroup.findMany({
      where: { householdId: req.household!.id }, include: groupItemInclude, orderBy: { name: 'asc' },
    });
    return { data: rows.map(serializeGroup) };
  });

  s.post('/groups', async (req) => {
    const hid = req.household!.id;
    const b = parse(groupCreateSchema, req.body);
    await assertStore(hid, b.preferredStoreId);
    const row = await prisma.itemGroup.create({
      data: {
        householdId: hid, name: b.name, minStock: b.minStock,
        preferredStoreId: b.preferredStoreId ?? null, renotifyAfterDays: b.renotifyAfterDays,
      },
      include: groupItemInclude,
    });
    return { data: serializeGroup(row) };
  });

  s.patch<{ Params: { id: string } }>('/groups/:id', async (req) => {
    const hid = req.household!.id;
    const existing = await load(hid, req.params.id);
    const b = parse(groupUpdateSchema, req.body);
    await assertStore(hid, b.preferredStoreId);
    const row = await prisma.itemGroup.update({
      where: { id: existing.id },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.minStock !== undefined ? { minStock: b.minStock } : {}),
        ...(b.preferredStoreId !== undefined ? { preferredStoreId: b.preferredStoreId } : {}),
        ...(b.renotifyAfterDays !== undefined ? { renotifyAfterDays: b.renotifyAfterDays } : {}),
      },
      include: groupItemInclude,
    });
    return { data: serializeGroup(row) };
  });

  s.delete<{ Params: { id: string } }>('/groups/:id', async (req, reply) => {
    const existing = await load(req.household!.id, req.params.id);
    await prisma.itemGroup.delete({ where: { id: existing.id } }); // FK ON DELETE SET NULL clears members' group_id
    return reply.code(204).send();
  });
}
