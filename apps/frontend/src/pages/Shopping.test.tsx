import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ShoppingListDto, UnitDto } from '@plantry/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from '../store';
import { ToastProvider } from '../components/Toast';
import { Shopping } from './Shopping';

const unit: UnitDto = { id: 'u1', name: 'unit', pluralName: 'units', abbreviation: null, global: true, step: 1 };

const list: ShoppingListDto = {
  groups: [
    {
      store: { id: 's1', name: 'Costco' },
      entries: [
        { kind: 'item', itemId: 'i1', name: 'Rice', unit, quantity: 2, low: true, manual: false, rowId: null, currentCount: 0, minStock: 2, thumbUrl: null },
      ],
    },
    {
      store: null,
      entries: [
        { kind: 'text', rowId: 'r1', name: 'Birthday candles', quantity: null, checkedOff: false },
      ],
    },
  ],
};

const json = (body: unknown) => new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } });
const errJson = (code: string, message: string, status = 409) =>
  new Response(JSON.stringify({ error: { code, message } }), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function url(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function renderShopping(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/h/h1/shopping']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <Routes>
            <Route path="/h/:hid/shopping" element={<Shopping />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );
  return store;
}

describe('Shopping screen', () => {
  it('renders store groups in order with Any store last, and tapping an item entry purchases it with Undo', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/shopping-list')) return json(list);
      if (u.includes('/stores')) return json([{ id: 's1', name: 'Costco', notes: null }]);
      if (u.includes('/purchase')) return json({ eventId: 'e1' });
      return json(null);
    });
    renderShopping(fetchMock);

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['Costco', 'Any store']);

    await userEvent.click(screen.getByRole('button', { name: /Got Rice/ }));

    expect(await screen.findByText(/Got .*Rice/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => url(c[0]).includes('/shopping-list/items/i1/purchase'))).toBe(true);
  });

  it('does not double-purchase when two taps land before a re-render', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/shopping-list')) return json(list);
      if (u.includes('/stores')) return json([{ id: 's1', name: 'Costco', notes: null }]);
      if (u.includes('/purchase')) return json({ eventId: 'e1' });
      return json(null);
    });
    renderShopping(fetchMock);
    const button = await screen.findByRole('button', { name: /Got Rice/ });

    // Two full tap cycles fired synchronously in one act, before React has a chance to
    // re-render and flip `isLoading` — both pointer-ups land while the ref-based guard
    // (not state) is the only thing that can have already flipped.
    act(() => {
      fireEvent.pointerDown(button);
      fireEvent.pointerUp(button);
      fireEvent.pointerDown(button);
      fireEvent.pointerUp(button);
    });

    await screen.findByText(/Got .*Rice/);
    const purchaseCalls = fetchMock.mock.calls.filter((c) => url(c[0]).includes('/purchase'));
    expect(purchaseCalls.length).toBe(1);
  });

  it('surfaces a toast when Undo fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/shopping-list')) return json(list);
      if (u.includes('/stores')) return json([{ id: 's1', name: 'Costco', notes: null }]);
      if (u.includes('/purchase')) return json({ eventId: 'e1' });
      if (u.includes('/inventory/events/')) return errJson('undo_expired', 'Too late to undo');
      return json(null);
    });
    renderShopping(fetchMock);

    await userEvent.click(await screen.findByRole('button', { name: /Got Rice/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(await screen.findByText('Too late to undo')).toBeInTheDocument();
  });
});
