import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import type { ItemDto } from '@plantry/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from '../store';
import { PhotoPicker } from './PhotoPicker';
import { ToastProvider } from './Toast';

const unit = { id: 'u1', name: 'unit', pluralName: 'units', abbreviation: null, global: true, step: 1 };
const item = {
  id: 'i1', name: 'Rice', description: null, category: null, unit, preferredStoreId: null, barcodes: [],
  renotifyAfterDays: 30, defaultRestockQty: 5, autoDeductQty: null, autoDeductPeriodDays: 30, autoDeductPaused: false,
  archivedAt: null, currentCount: 3, minStock: 2, low: false, trackLow: true, nagging: false, groupId: null, lastRestockedAt: null, nextTripRowId: null,
  imageUrl: 'https://example.test/img.jpg', thumbUrl: 'https://example.test/thumb.jpg', imageUrlsExpireAt: null,
} as ItemDto;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function renderPicker(deleteStatus: number) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.endsWith('/api/me')) return json({ data: { user: { isAdmin: false }, households: [], photosEnabled: true, pushEnabled: false, feedbackEnabled: false } });
    if (method === 'DELETE' && url.includes('/photo')) {
      return deleteStatus >= 400 ? json({ error: { code: 'server_error', message: 'Delete failed' } }, deleteStatus) : json({ data: null });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  const store = makeStore();
  render(
    <Provider store={store}>
      <ToastProvider>
        <PhotoPicker hid="h1" item={item} />
      </ToastProvider>
    </Provider>,
  );
}

describe('PhotoPicker remove', () => {
  it('toasts the error and re-enables the button when the delete fails', async () => {
    renderPicker(500);
    const removeBtn = await screen.findByRole('button', { name: 'Remove' });
    await userEvent.click(removeBtn);
    expect(await screen.findByText('Delete failed')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Remove' })).toBeEnabled();
  });
});
