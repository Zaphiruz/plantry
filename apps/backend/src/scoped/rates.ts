import type { FastifyInstance } from 'fastify';
import { rateWindowSchema } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { parse } from '../errors.js';
import { loadItem } from '../services/items.js';
import { consumptionRates } from '../services/rates.js';

export function registerRateRoutes(s: FastifyInstance, deps: Deps): void {
  s.get<{ Querystring: { window?: string } }>('/items/consumption-rates', async (req) => {
    const window = parse(rateWindowSchema, req.query.window);
    return { data: await consumptionRates(deps.prisma, req.household!.id, window) };
  });

  s.get<{ Params: { id: string }; Querystring: { window?: string } }>('/items/:id/consumption-rate', async (req) => {
    const window = parse(rateWindowSchema, req.query.window);
    const item = await loadItem(deps, req.household!.id, req.params.id);
    const [rate] = await consumptionRates(deps.prisma, req.household!.id, window, { itemId: item.id });
    return { data: rate };
  });
}
