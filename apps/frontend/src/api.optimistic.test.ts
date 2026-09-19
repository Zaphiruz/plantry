import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemDto } from '@plantry/shared';
import { api } from './api';
import { makeStore } from './store';

const item = { id: 'i1', name: 'Rice', currentCount: 3, minStock: 2, low: false } as ItemDto;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('optimistic stepper', () => {
  it('applies the delta immediately, flips `low`, and rolls back when the server rejects', async () => {
    let failConsume!: () => void;
    vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
      if (req.url.endsWith('/inventory')) return json({ data: [item] });
      await new Promise<void>((r) => { failConsume = r; });
      return json({ error: { code: 'internal', message: 'nope' } }, 500);
    }));
    const store = makeStore();
    await store.dispatch(api.endpoints.getInventory.initiate('h1'));
    const read = () => api.endpoints.getInventory.select('h1')(store.getState()).data![0]!;

    const pending = store.dispatch(api.endpoints.consume.initiate({ hid: 'h1', itemId: 'i1', quantity: 1 }));
    await vi.waitFor(() => expect(read().currentCount).toBe(2));
    expect(read().low).toBe(true);

    failConsume();
    await pending;
    expect(read().currentCount).toBe(3);
    expect(read().low).toBe(false);
  });
});
