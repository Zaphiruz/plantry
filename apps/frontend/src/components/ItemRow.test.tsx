import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { ItemDto } from '@plantry/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from '../store';
import { ItemRow } from './ItemRow';
import { ToastProvider } from './Toast';

const unit = { id: 'u1', name: 'unit', pluralName: 'units', abbreviation: null, global: true, step: 1 };
const item = {
  id: 'i1', name: 'Rice', description: null, category: null, unit, preferredStoreId: null, barcode: null,
  renotifyAfterDays: 30, defaultRestockQty: 5, autoDeductQty: null, autoDeductPeriodDays: 30, autoDeductPaused: false,
  archivedAt: null, currentCount: 3, minStock: 2, low: false, lastRestockedAt: null, nextTripRowId: null,
  imageUrl: null, thumbUrl: null, imageUrlsExpireAt: null,
} as ItemDto;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function renderRow(eventId: string | null) {
  vi.stubGlobal('fetch', vi.fn(async () => json({ data: { item, eventId } })));
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <ItemRow hid="h1" item={item} />
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );
}

describe('ItemRow undo affordance', () => {
  it('offers no Undo button when the mutation returns no eventId', async () => {
    renderRow(null);
    await userEvent.click(screen.getByRole('button', { name: 'Use 1 unit Rice' }));
    expect(await screen.findByText(/Used .* Rice/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('offers an Undo button when the mutation returns an eventId', async () => {
    renderRow('e1');
    await userEvent.click(screen.getByRole('button', { name: 'Use 1 unit Rice' }));
    expect(await screen.findByText(/Used .* Rice/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });
});

describe('ItemRow step-sized tap', () => {
  it('tapping - on a step-8 unit consumes 8', async () => {
    const stepUnit = { ...unit, id: 'u8', step: 8 };
    const stepItem = { ...item, unit: stepUnit } as ItemDto;
    const fetchMock = vi.fn(async (_req: Request) => json({ data: { item: stepItem, eventId: null } }));
    vi.stubGlobal('fetch', fetchMock);
    const store = makeStore();
    render(
      <Provider store={store}>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ToastProvider>
            <ItemRow hid="h1" item={stepItem} />
          </ToastProvider>
        </MemoryRouter>
      </Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Use 8 units Rice' }));
    await screen.findByText(/Used .* Rice/);
    const consumeReq = fetchMock.mock.calls.map((c) => c[0] as Request).find((req) => req.url.includes('/consume'));
    expect(consumeReq).toBeDefined();
    const body = JSON.parse(await consumeReq!.clone().text());
    expect(body.quantity).toBe(8);
  });
});
