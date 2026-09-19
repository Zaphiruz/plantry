import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ItemDto } from '@plantry/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { makeStore } from '../store';
import { ToastProvider } from '../components/Toast';
import { ItemForm } from './ItemForm';

const units = [
  { id: 'u-each', name: 'each', pluralName: null, abbreviation: null, global: true },
  { id: 'u-other', name: 'bag', pluralName: 'bags', abbreviation: null, global: false },
];

const baseItem = {
  id: 'i1', name: 'Rice', description: null, category: null, unit: units[0], preferredStoreId: null, barcode: null,
  renotifyAfterDays: 7, defaultRestockQty: 1, autoDeductQty: null, autoDeductPeriodDays: 1, autoDeductPaused: false,
  archivedAt: null, currentCount: 3, minStock: 1, low: false, lastRestockedAt: null, nextTripRowId: null,
  imageUrl: null, thumbUrl: null, imageUrlsExpireAt: null,
} as ItemDto;

const json = (body: unknown) => new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function url(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function renderForm(path: string, routePath: string, fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <Routes>
            <Route path={routePath} element={<ItemForm />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

describe('ItemForm new-item defaults', () => {
  it('pre-fills the barcode from the query string and defaults the unit to "each"', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/units')) return json(units);
      if (u.includes('/stores')) return json([]);
      return json(null);
    });
    renderForm('/h/h1/items/new?barcode=123', '/h/:hid/items/new', fetchMock);
    expect(await screen.findByDisplayValue('123')).toBeInTheDocument();
    const unitSelect = (await screen.findByRole('combobox', { name: 'Unit' })) as HTMLSelectElement;
    await vi.waitFor(() => expect(unitSelect.value).toBe('u-each'));
  });
});

describe('ItemForm edit-mode hydration', () => {
  it('does not overwrite in-progress edits when the server data is refetched in the background', async () => {
    let serverName = 'Rice';
    let itemFetchCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/units')) return json(units);
      if (u.includes('/stores')) return json([]);
      if (u.includes('/items/i1')) { itemFetchCount += 1; return json({ ...baseItem, name: serverName }); }
      return json(null);
    });
    const store = renderForm('/h/h1/items/i1/edit', '/h/:hid/items/:id/edit', fetchMock);

    const name = (await screen.findByDisplayValue('Rice')) as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, 'Brown rice');
    expect(name.value).toBe('Brown rice');

    // Simulate the item changing on the server (another member, or the auto-deduct job) and a
    // background refetch firing (e.g. refetchOnFocus/refetchOnReconnect from store.ts).
    serverName = 'Rice (server)';
    const countBefore = itemFetchCount;
    store.dispatch(api.util.invalidateTags(['Items']));
    await vi.waitFor(() => expect(itemFetchCount).toBeGreaterThan(countBefore));

    // The refetch must not clobber the user's unsaved edit.
    expect(name.value).toBe('Brown rice');
  });
});
