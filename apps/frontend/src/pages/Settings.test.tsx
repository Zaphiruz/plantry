import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MeDto } from '@plantry/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from '../store';
import { ToastProvider } from '../components/Toast';
import { Settings } from './Settings';

const baseMe: MeDto = {
  user: { sub: 'me', name: 'Me', email: 'me@example.com', isAdmin: false },
  households: [{ id: 'h1', name: 'Home', role: 'member' }],
  photosEnabled: false,
  pushEnabled: false,
  feedbackEnabled: false,
};

const json = (body: unknown) => new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

function url(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function renderSettings(me: MeDto) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const u = url(input);
    if (u.includes('/api/me')) return json(me);
    if (u.includes('/members')) return json([{ sub: 'me', name: 'Me', email: 'me@example.com', role: me.households[0]!.role, joinedAt: new Date().toISOString() }]);
    if (u.includes('/stores')) return json([]);
    if (u.includes('/units')) return json([]);
    if (u.includes('/items?archived=true')) return json([]);
    if (u.includes('/feedback/mine')) return json([]);
    if (u.includes('/push/vapid-key')) return json({ publicKey: null });
    return json(null);
  });
  vi.stubGlobal('fetch', fetchMock);
  const store = makeStore();
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/h/h1/settings']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastProvider>
          <Routes>
            <Route path="/h/:hid/settings" element={<Settings />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );
}

describe('Settings', () => {
  it('a non-owner member sees no Rename or Remove controls', async () => {
    renderSettings(baseMe);
    await screen.findByText('Home');
    expect(screen.queryByLabelText('Household name')).not.toBeInTheDocument();
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
  });

  it('hides the Feedback section when feedbackEnabled is false', async () => {
    renderSettings(baseMe);
    await screen.findByText('Home');
    expect(screen.queryByText('Feedback')).not.toBeInTheDocument();
  });

  it('shows "Not configured on this server." when pushEnabled is false', async () => {
    renderSettings(baseMe);
    expect(await screen.findByText('Not configured on this server.')).toBeInTheDocument();
  });
});
