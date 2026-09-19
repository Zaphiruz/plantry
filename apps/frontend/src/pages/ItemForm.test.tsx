import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from '../store';
import { ToastProvider } from '../components/Toast';
import { ItemForm } from './ItemForm';

const units = [
  { id: 'u-each', name: 'each', pluralName: null, abbreviation: null, global: true },
  { id: 'u-other', name: 'bag', pluralName: 'bags', abbreviation: null, global: false },
];

const json = (body: unknown) => new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function renderForm(path: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/units')) return json(units);
    if (url.includes('/stores')) return json([]);
    return json(null);
  }));
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <Routes>
            <Route path="/h/:hid/items/new" element={<ItemForm />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );
}

describe('ItemForm new-item defaults', () => {
  it('pre-fills the barcode from the query string and defaults the unit to "each"', async () => {
    renderForm('/h/h1/items/new?barcode=123');
    expect(await screen.findByDisplayValue('123')).toBeInTheDocument();
    const unitSelect = (await screen.findByRole('combobox', { name: 'Unit' })) as HTMLSelectElement;
    await vi.waitFor(() => expect(unitSelect.value).toBe('u-each'));
  });
});
