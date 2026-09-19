import type { FastifyInstance } from 'fastify';
import type { Unit } from '@prisma/client';
import { unitCreateSchema, unitUpdateSchema, type UnitDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, forbidden, notFound, parse } from '../errors.js';
import { uuidParam } from '../lib/ids.js';

export const toUnitDto = (u: Unit): UnitDto => ({
  id: u.id, name: u.name, pluralName: u.pluralName, abbreviation: u.abbreviation, global: u.householdId === null,
});

export function registerUnitRoutes(s: FastifyInstance, deps: Deps): void {
  const loadOwn = async (hid: string, id: unknown) => {
    const row = await deps.prisma.unit.findFirst({
      where: { id: uuidParam(id), OR: [{ householdId: hid }, { householdId: null }] },
    });
    if (!row) throw notFound();
    if (row.householdId === null) throw forbidden('Global units are read-only');
    return row;
  };

  s.get('/units', async (req) => {
    const rows = await deps.prisma.unit.findMany({
      where: { OR: [{ householdId: req.household!.id }, { householdId: null }] },
      orderBy: [{ name: 'asc' }],
    });
    return { data: rows.map(toUnitDto) };
  });

  s.post('/units', async (req) => {
    const b = parse(unitCreateSchema, req.body);
    const row = await deps.prisma.unit.create({
      data: { householdId: req.household!.id, name: b.name, pluralName: b.pluralName ?? null, abbreviation: b.abbreviation ?? null },
    });
    return { data: toUnitDto(row) };
  });

  s.patch<{ Params: { id: string } }>('/units/:id', async (req) => {
    const existing = await loadOwn(req.household!.id, req.params.id);
    const b = parse(unitUpdateSchema, req.body);
    const row = await deps.prisma.unit.update({
      where: { id: existing.id },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.pluralName !== undefined ? { pluralName: b.pluralName } : {}),
        ...(b.abbreviation !== undefined ? { abbreviation: b.abbreviation } : {}),
      },
    });
    return { data: toUnitDto(row) };
  });

  s.delete<{ Params: { id: string } }>('/units/:id', async (req, reply) => {
    const existing = await loadOwn(req.household!.id, req.params.id);
    await deps.prisma.$transaction(async (tx) => {
      const itemCount = await tx.item.count({ where: { unitId: existing.id, archivedAt: null } });
      if (itemCount > 0) throw new AppError(409, 'unit_in_use', `Unit is used by ${itemCount} item(s)`, { itemCount });
      const each = await tx.unit.findFirstOrThrow({ where: { householdId: null, name: 'each' } });
      await tx.item.updateMany({ where: { unitId: existing.id }, data: { unitId: each.id } });
      await tx.unit.delete({ where: { id: existing.id } });
    });
    return reply.code(204).send();
  });
}
