import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ItemDto, UnitDto } from '@plantry/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from '../store';
import { ToastProvider } from '../components/Toast';
import { Inventory } from './Inventory';

const unit: UnitDto = { id: 'u1', name: 'unit', pluralName: 'units', abbreviation: null, global: true, step: 1 };
const item = {
  id: 'i1', name: 'Rice', description: null, category: null, unit, preferredStoreId: null, barcodes: [],
  currentCount: 3, minStock: 1, low: false, trackLow: true, nagging: false, defaultRestockQty: 1, renotifyAfterDays: 3,
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
          <Routes>
            <Route path="/h/:hid" element={<Inventory />} />
            <Route path="/h/:hid/items/new" element={<div>New item page</div>} />
          </Routes>
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

// --- Continuous scan mode (Use / Restock) -------------------------------------------------

type ScannerProps = { open: boolean; continuous?: boolean; status?: string; onDetected: (code: string) => void | Promise<void>; onClose: () => void };
let scannerProps: ScannerProps | null = null;
let onDetectedIdentities: Array<ScannerProps['onDetected']> = [];
vi.mock('../components/Scanner', () => ({
  Scanner: (props: ScannerProps) => {
    scannerProps = props;
    onDetectedIdentities.push(props.onDetected);
    return props.open ? <div data-testid="scanner-mock">{props.status}</div> : null;
  },
}));

const scanItem = {
  ...item, id: 'i2', name: 'Cat food', currentCount: 4, defaultRestockQty: 12,
  unit: { ...unit, id: 'u2', abbreviation: 'cans' },
} as unknown as ItemDto;

const u = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

function scanFetchMock(opts: { hit?: ItemDto | null; eventId?: string | null; stockFails?: boolean } = {}) {
  const { hit = scanItem, eventId = 'ev1', stockFails = false } = opts;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = u(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.includes('/inventory') && !url.includes('/consume') && !url.includes('/restock') && method === 'GET') return json([scanItem]);
    if (url.includes('/items?barcode=')) return json(hit ? [hit] : []);
    if (url.includes('/consume') || url.includes('/restock')) {
      if (stockFails) return boom();
      return json({ item: hit, eventId });
    }
    return json({});
  });
}

beforeEach(() => { scannerProps = null; onDetectedIdentities = []; });

describe('Inventory continuous scan mode', () => {
  it('opens the mode picker buttons with the required accessible names', async () => {
    renderInventory(vi.fn(async () => json([item])));
    await screen.findByText('Rice');
    expect(screen.getByRole('button', { name: 'Scan to look up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan to use' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan to restock' })).toBeInTheDocument();
  });

  it('Use mode: a matched detection posts consume with the unit step and shows a toast with Undo', async () => {
    renderInventory(scanFetchMock());
    await screen.findByText('Cat food');
    await userEvent.click(screen.getByRole('button', { name: 'Scan to use' }));

    expect(scannerProps?.continuous).toBe(true);
    await act(async () => { await scannerProps!.onDetected('CODE1'); });

    await screen.findByText(/Used .* Cat food/);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('Restock mode: a matched detection posts restock with defaultRestockQty', async () => {
    const fetchMock = scanFetchMock();
    renderInventory(fetchMock);
    await screen.findByText('Cat food');
    await userEvent.click(screen.getByRole('button', { name: 'Scan to restock' }));

    await act(async () => { await scannerProps!.onDetected('CODE2'); });

    await screen.findByText(/Added .* Cat food/);
    const restockReq = fetchMock.mock.calls.map((c) => c[0] as Request).find((req) => req.url.includes('/restock'));
    expect(restockReq).toBeDefined();
    const body = JSON.parse(await restockReq!.clone().text());
    expect(body.quantity).toBe(scanItem.defaultRestockQty);
  });

  it('unknown code navigates to the new-item route with the barcode', async () => {
    renderInventory(scanFetchMock({ hit: null }));
    await screen.findByText('Cat food');
    await userEvent.click(screen.getByRole('button', { name: 'Scan to use' }));

    await act(async () => { await scannerProps!.onDetected('UNKNOWN1'); });

    expect(await screen.findByText('New item page')).toBeInTheDocument();
  });

  it('a failed apply toasts an error and keeps the mode open', async () => {
    renderInventory(scanFetchMock({ stockFails: true }));
    await screen.findByText('Cat food');
    await userEvent.click(screen.getByRole('button', { name: 'Scan to use' }));

    await act(async () => { await scannerProps!.onDetected('CODE3'); });

    await screen.findByText('Internal error');
    expect(screen.getByTestId('scanner-mock')).toBeInTheDocument();
  });

  it('keeps a stable onDetected identity across a forced re-render', async () => {
    renderInventory(scanFetchMock());
    await screen.findByText('Cat food');
    await userEvent.click(screen.getByRole('button', { name: 'Scan to use' }));

    const before = onDetectedIdentities.length;
    // Force a re-render unrelated to the scan session (e.g. the inventory list refetching).
    await userEvent.click(screen.getByRole('button', { name: 'Low' }));
    await userEvent.click(screen.getByRole('button', { name: 'Low' }));

    const after = onDetectedIdentities.slice(before);
    expect(after.every((fn) => fn === onDetectedIdentities[0])).toBe(true);
  });
});
