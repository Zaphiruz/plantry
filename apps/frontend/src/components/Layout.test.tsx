import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MeDto } from '@plantry/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
import { makeStore } from '../store';
import { Layout } from './Layout';

const meWithoutH2: MeDto = {
  user: { sub: 'me', name: 'Me', email: 'me@example.com', isAdmin: false },
  households: [{ id: 'h1', name: 'Home', role: 'owner' }],
  photosEnabled: false,
  pushEnabled: false,
  feedbackEnabled: false,
};
const meWithH2: MeDto = { ...meWithoutH2, households: [...meWithoutH2.households, { id: 'h2', name: 'New home', role: 'owner' }] };

const json = (body: unknown) => new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } });

function url(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

afterEach(() => vi.unstubAllGlobals());

describe('Layout', () => {
  // Regression test for a bug found by the Playwright smoke test: creating a household
  // invalidates the "Me" tag and navigates straight to the new household's URL, but the
  // refetch of /me that would make the new household show up in the cached list is async.
  // Layout used to redirect to "/" the instant it rendered with a hid not yet present in the
  // (stale) cached `me`, bouncing the user back before the refetch resolved.
  it('does not redirect to "/" while a stale "me" is being refetched to pick up a just-created household', async () => {
    let resolveRefetch!: (v: Response) => void;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = url(input);
      if (u.includes('/api/me')) {
        // First call (initial load) resolves immediately with the stale list; the second
        // call (the refetch triggered by invalidating "Me") stays pending until we resolve it.
        if (fetchMock.mock.calls.length === 1) return json(meWithoutH2);
        return new Promise<Response>((resolve) => { resolveRefetch = resolve; });
      }
      if (u.includes('/inventory')) return json([]);
      return json(null);
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = makeStore();
    // Warm the cache with the stale list, like a page that's already been sitting open.
    await store.dispatch(api.endpoints.getMe.initiate()).unwrap();
    // Simulate the invalidation a create-household mutation triggers, which schedules a refetch.
    store.dispatch(api.util.invalidateTags(['Me']));

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={['/h/h2']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/h/:hid" element={<Layout />}>
              <Route index element={<p>Inventory content</p>} />
            </Route>
            <Route path="/" element={<p>Household picker</p>} />
          </Routes>
        </MemoryRouter>
      </Provider>,
    );

    // While the refetch is in flight, we must stay put rather than bounce to "/".
    expect(await screen.findByText('Inventory content')).toBeInTheDocument();
    expect(screen.queryByText('Household picker')).not.toBeInTheDocument();

    // Once the refetch resolves with h2 included, we should still be on the household route.
    resolveRefetch(json(meWithH2));
    expect(await screen.findByText('Inventory content')).toBeInTheDocument();
    expect(screen.queryByText('Household picker')).not.toBeInTheDocument();
  });
});
