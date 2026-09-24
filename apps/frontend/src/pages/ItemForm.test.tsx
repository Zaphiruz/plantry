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
  { id: 'u-each', name: 'each', pluralName: null, abbreviation: null, global: true, step: 1 },
  { id: 'u-other', name: 'bag', pluralName: 'bags', abbreviation: null, global: false, step: 6 },
];

const baseItem = {
  id: 'i1', name: 'Rice', description: null, category: null, unit: units[0], preferredStoreId: null, barcodes: [],
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
    expect(await screen.findByText('123')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Remove barcode 123' })).toBeInTheDocument();
    const unitSelect = (await screen.findByRole('combobox', { name: 'Unit' })) as HTMLSelectElement;
    await vi.waitFor(() => expect(unitSelect.value).toBe('u-each'));
  });

  it('defaults "Usually buy" to the selected unit\'s step, and updates it when the unit changes (until hand-edited)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/units')) return json(units);
      if (u.includes('/stores')) return json([]);
      return json(null);
    });
    renderForm('/h/h1/items/new', '/h/:hid/items/new', fetchMock);
    const restock = (await screen.findByLabelText('Usually buy')) as HTMLInputElement;
    await vi.waitFor(() => expect(restock.value).toBe('1'));

    const unitSelect = (await screen.findByRole('combobox', { name: 'Unit' })) as HTMLSelectElement;
    await vi.waitFor(() => expect(unitSelect.options.length).toBe(2));
    await userEvent.selectOptions(unitSelect, 'u-other');
    await vi.waitFor(() => expect(restock.value).toBe('6'));
  });

  it('stops auto-updating "Usually buy" once the user has typed into it', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/units')) return json(units);
      if (u.includes('/stores')) return json([]);
      return json(null);
    });
    renderForm('/h/h1/items/new', '/h/:hid/items/new', fetchMock);
    const restock = (await screen.findByLabelText('Usually buy')) as HTMLInputElement;
    await vi.waitFor(() => expect(restock.value).toBe('1'));
    await userEvent.clear(restock);
    await userEvent.type(restock, '3');

    const unitSelect = (await screen.findByRole('combobox', { name: 'Unit' })) as HTMLSelectElement;
    await vi.waitFor(() => expect(unitSelect.options.length).toBe(2));
    await userEvent.selectOptions(unitSelect, 'u-other');
    expect(restock.value).toBe('3');
  });
});

describe('ItemForm manual validation', () => {
  it('rejects a negative "Minimum to keep" with an inline error and never submits', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/units')) return json(units);
      if (u.includes('/stores')) return json([]);
      return json(null);
    });
    renderForm('/h/h1/items/new', '/h/:hid/items/new', fetchMock);
    await userEvent.type(await screen.findByLabelText('Name'), 'Cat food');
    const min = await screen.findByLabelText('Minimum to keep');
    await userEvent.clear(min);
    await userEvent.type(min, '-1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Minimum to keep/);
    expect(fetchMock.mock.calls.some((c) => url(c[0]).includes('/items') && (c[0] as Request).method === 'POST')).toBe(false);
  });

  it('rejects an emptied "Minimum to keep" instead of silently coercing it to 0', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/units')) return json(units);
      if (u.includes('/stores')) return json([]);
      return json(null);
    });
    renderForm('/h/h1/items/new', '/h/:hid/items/new', fetchMock);
    await userEvent.type(await screen.findByLabelText('Name'), 'Cat food');
    const min = await screen.findByLabelText('Minimum to keep');
    await userEvent.clear(min);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Minimum to keep/);
    expect(fetchMock.mock.calls.some((c) => url(c[0]).includes('/items') && (c[0] as Request).method === 'POST')).toBe(false);
  });

  it('rejects an emptied "Have now" on a new item instead of silently coercing it to 0', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/units')) return json(units);
      if (u.includes('/stores')) return json([]);
      return json(null);
    });
    renderForm('/h/h1/items/new', '/h/:hid/items/new', fetchMock);
    await userEvent.type(await screen.findByLabelText('Name'), 'Cat food');
    const have = await screen.findByLabelText('Have now');
    await userEvent.clear(have);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Have now/);
    expect(fetchMock.mock.calls.some((c) => url(c[0]).includes('/items') && (c[0] as Request).method === 'POST')).toBe(false);
  });

  it('accepts a valid off-step "Usually buy" value (mirrors the server: any positive value with <=3dp)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/units')) return json(units);
      if (u.includes('/stores')) return json([]);
      if (u.includes('/items') && (input as Request).method === 'POST') return json({ id: 'new1' });
      return json(null);
    });
    renderForm('/h/h1/items/new', '/h/:hid/items/new', fetchMock);
    await userEvent.type(await screen.findByLabelText('Name'), 'Cat food');
    const restock = await screen.findByLabelText('Usually buy');
    await userEvent.clear(restock);
    await userEvent.type(restock, '1.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => {
      const created = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.url.includes('/items') && r.method === 'POST');
      expect(created).toBeDefined();
    });
  });
});

describe('ItemForm barcode chip list', () => {
  it('Add appends a chip, Enter also adds, duplicate shows an inline alert and does not append, x removes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/units')) return json(units);
      if (u.includes('/stores')) return json([]);
      return json(null);
    });
    renderForm('/h/h1/items/new', '/h/:hid/items/new', fetchMock);
    const addInput = await screen.findByLabelText('Add barcode');

    await userEvent.type(addInput, '111');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('111')).toBeInTheDocument();

    await userEvent.type(addInput, '222{Enter}');
    expect(await screen.findByText('222')).toBeInTheDocument();

    await userEvent.type(addInput, '111');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already/i);
    expect(screen.getAllByText('111')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Remove barcode 111' }));
    expect(screen.queryByText('111')).not.toBeInTheDocument();
  });

  it('submits the accumulated barcodes list', async () => {
    let createdBody: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/units')) return json(units);
      if (u.includes('/stores')) return json([]);
      if (u.includes('/items') && (input as Request).method === 'POST') {
        createdBody = JSON.parse(await (input as Request).text());
        return json({ id: 'new1' });
      }
      return json(null);
    });
    renderForm('/h/h1/items/new', '/h/:hid/items/new', fetchMock);
    await userEvent.type(await screen.findByLabelText('Name'), 'Cat food');
    const addInput = await screen.findByLabelText('Add barcode');
    await userEvent.type(addInput, '111{Enter}');
    await userEvent.type(addInput, '222{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(createdBody).toBeDefined());
    expect((createdBody as { barcodes: string[] }).barcodes).toEqual(['111', '222']);
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
