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

  it('two rapid taps that both fail end at the original count', async () => {
    const release: (() => void)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
      if (req.url.endsWith('/inventory')) return json({ data: [item] });
      await new Promise<void>((r) => release.push(r));
      return json({ error: { code: 'internal', message: 'nope' } }, 500);
    }));
    const store = makeStore();
    await store.dispatch(api.endpoints.getInventory.initiate('h1'));
    const read = () => api.endpoints.getInventory.select('h1')(store.getState()).data![0]!;

    const a = store.dispatch(api.endpoints.consume.initiate({ hid: 'h1', itemId: 'i1', quantity: 1 }));
    const b = store.dispatch(api.endpoints.consume.initiate({ hid: 'h1', itemId: 'i1', quantity: 1 }));
    await vi.waitFor(() => expect(read().currentCount).toBe(1));

    // The first tap fails first: `patch.undo()` would restore the snapshot taken before tap A
    // (3), then restore the one taken before tap B (2), landing on 2. An inverse delta composes.
    await vi.waitFor(() => expect(release.length).toBe(2));
    release[0]!(); await a;
    release[1]!(); await b;

    expect(read().currentCount).toBe(3);
    expect(read().low).toBe(false);
  });
});
