import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { EventDto, ItemDto, UnitDto } from '@plantry/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from '../store';
import { ToastProvider } from '../components/Toast';
import { ItemDetail } from './ItemDetail';

const unit: UnitDto = { id: 'u1', name: 'unit', pluralName: 'units', abbreviation: null, global: true };
const item = {
  id: 'i1', name: 'Rice', description: null, category: null, unit, preferredStoreId: null, barcode: null,
  currentCount: 3, minStock: 1, low: false, defaultRestockQty: 1, renotifyAfterDays: 3,
  autoDeductQty: null, autoDeductPeriodDays: 1, autoDeductPaused: false, archivedAt: null,
  photoUrl: null, thumbUrl: null, nextTripRowId: null,
} as unknown as ItemDto;

const event = (n: number): EventDto => ({
  id: `e${n}`, eventType: 'consume', quantity: n, note: `note ${n}`,
  userName: 'Ada', createdAt: '2026-09-19T00:00:00.000Z',
} as unknown as EventDto);

const PAGE_1 = Array.from({ length: 30 }, (_, i) => event(i + 1));
const PAGE_2 = Array.from({ length: 25 }, (_, i) => event(i + 31));

const json = (body: unknown) => new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } });
const err = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

const u = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

function renderDetail(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={['/h/h1/items/i1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <Routes><Route path="/h/:hid/items/:id" element={<ItemDetail />} /></Routes>
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );
}

describe('ItemDetail history paging', () => {
  it('keeps earlier pages visible after "Older"', async () => {
    renderDetail(vi.fn(async (input: RequestInfo | URL) => {
      const url = u(input);
      if (url.includes('/events?cursor=')) return json({ events: PAGE_2, nextCursor: null });
      if (url.includes('/events')) return json({ events: PAGE_1, nextCursor: 'c1' });
      if (url.includes('/items/i1')) return json(item);
      if (url.includes('/inventory')) return json([item]);
      if (url.includes('/me')) return json({ user: { sub: 'me', name: 'Me', isAdmin: false }, households: [] });
      return json(null);
    }));

    expect(await screen.findByText(/note 1$/)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Older' }));

    expect(await screen.findByText(/note 55$/)).toBeInTheDocument();
    expect(screen.getByText(/note 1$/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Used .*note \d+$/)).toHaveLength(55);
  });
});

describe('ItemDetail "Correct count"', () => {
  const baseMock = (adjustResponse: () => Response) => vi.fn(async (input: RequestInfo | URL) => {
    const url = u(input);
    if (url.includes('/adjust')) return adjustResponse();
    if (url.includes('/events')) return json({ events: [], nextCursor: null });
    if (url.includes('/items/i1')) return json(item);
    if (url.includes('/inventory')) return json([item]);
    return json(null);
  });

  const correctTo = async (n: string) => {
    await userEvent.click(await screen.findByRole('button', { name: 'Correct count' }));
    const input = await screen.findByLabelText('Quantity');
    await userEvent.clear(input);
    await userEvent.type(input, n);
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
  };

  it('offers Undo when the adjust returns an eventId', async () => {
    const fetchMock = baseMock(() => json({ item, eventId: 'ev9' }));
    renderDetail(fetchMock);
    await correctTo('7');

    expect(await screen.findByText(/Set to 7 units/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(fetchMock.mock.calls.some((c) => u(c[0]).includes('/inventory/events/ev9'))).toBe(true);
  });

  it('offers no Undo when the adjust was a no-op (null eventId)', async () => {
    renderDetail(baseMock(() => json({ item, eventId: null })));
    await correctTo('7');

    expect(await screen.findByText(/Set to 7 units/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('surfaces an adjust failure as a toast', async () => {
    renderDetail(baseMock(() => err(409, 'conflict', 'Nope')));
    await correctTo('7');

    expect(await screen.findByText('Nope')).toBeInTheDocument();
  });
});

describe('ItemDetail query errors', () => {
  it('a 404 says the item is gone and links back to the inventory', async () => {
    renderDetail(vi.fn(async (input: RequestInfo | URL) => {
      const url = u(input);
      if (url.includes('/items/i1')) return err(404, 'not_found', 'Not found');
      return json(null);
    }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer exists/i);
    expect(screen.getByRole('link', { name: /inventory/i })).toHaveAttribute('href', '/h/h1');
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('a 500 shows the message and a retry button', async () => {
    renderDetail(vi.fn(async (input: RequestInfo | URL) => {
      const url = u(input);
      if (url.includes('/items/i1')) return err(500, 'internal', 'Internal error');
      return json(null);
    }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal error');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
