import type { FastifyInstance } from 'fastify';
import type { Store } from '@prisma/client';
import { storeCreateSchema, storeUpdateSchema, type StoreDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { notFound, parse } from '../errors.js';
import { uuidParam } from '../lib/ids.js';

const toDto = (s: Store): StoreDto => ({ id: s.id, name: s.name, notes: s.notes });

export function registerStoreRoutes(s: FastifyInstance, deps: Deps): void {
  const load = async (hid: string, id: unknown) => {
    const row = await deps.prisma.store.findFirst({ where: { id: uuidParam(id), householdId: hid } });
    if (!row) throw notFound();
    return row;
  };

  s.get('/stores', async (req) => {
    const rows = await deps.prisma.store.findMany({ where: { householdId: req.household!.id }, orderBy: { name: 'asc' } });
    return { data: rows.map(toDto) };
  });

  s.post('/stores', async (req) => {
    const body = parse(storeCreateSchema, req.body);
    const row = await deps.prisma.store.create({
      data: { householdId: req.household!.id, name: body.name, notes: body.notes ?? null },
    });
    return { data: toDto(row) };
  });

  s.patch<{ Params: { id: string } }>('/stores/:id', async (req) => {
    const existing = await load(req.household!.id, req.params.id);
    const body = parse(storeUpdateSchema, req.body);
    const row = await deps.prisma.store.update({
      where: { id: existing.id },
      data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}) },
    });
    return { data: toDto(row) };
  });

  s.delete<{ Params: { id: string } }>('/stores/:id', async (req, reply) => {
    const existing = await load(req.household!.id, req.params.id);
    await deps.prisma.store.delete({ where: { id: existing.id } }); // FKs are ON DELETE SET NULL
    return reply.code(204).send();
  });
}
