import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ItemDto, UnitDto } from '@plantry/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from '../store';
import { ToastProvider } from '../components/Toast';
import { Inventory } from './Inventory';

const unit: UnitDto = { id: 'u1', name: 'unit', pluralName: 'units', abbreviation: null, global: true, step: 1 };
const item = {
  id: 'i1', name: 'Rice', description: null, category: null, unit, preferredStoreId: null, barcodes: [],
  currentCount: 3, minStock: 1, low: false, defaultRestockQty: 1, renotifyAfterDays: 3,
  autoDeductQty: null, autoDeductPeriodDays: 1, autoDeductPaused: false, archivedAt: null,
  photoUrl: null, thumbUrl: null, nextTripRowId: null,
} as unknown as ItemDto;

const json = (body: unknown) => new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } });
const boom = () => new Response(JSON.stringify({ error: { code: 'internal', message: 'Internal error' } }), { status: 500, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function renderInventory(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  render(
    <Provider store={makeStore()}>
      <MemoryRouter initialEntries={['/h/h1']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <Routes><Route path="/h/:hid" element={<Inventory />} /></Routes>
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );
}

describe('Inventory query errors', () => {
  it('shows the error and a retry button instead of a permanent Loading…', async () => {
    renderInventory(vi.fn(async () => boom()));

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal error');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('retry refetches and renders the list', async () => {
    let fail = true;
    renderInventory(vi.fn(async () => (fail ? boom() : json([item]))));

    await screen.findByRole('alert');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Rice')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
