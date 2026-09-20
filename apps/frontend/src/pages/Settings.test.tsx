import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { MeDto, UnitDto } from '@plantry/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';
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

function renderSettings(me: MeDto, unitsBox: { current: UnitDto[] } = { current: [] }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const u = url(input);
    const method = input instanceof Request ? input.method : 'GET';
    if (u.includes('/api/me')) return json(me);
    if (u.includes('/members')) return json([{ sub: 'me', name: 'Me', email: 'me@example.com', role: me.households[0]!.role, joinedAt: new Date().toISOString() }]);
    if (u.includes('/stores')) return json([]);
    if (u.includes('/units') && method === 'GET') return json(unitsBox.current);
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
  return { fetchMock, store };
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

describe('Settings custom units', () => {
  it('creating a unit sends step', async () => {
    const { fetchMock } = renderSettings(baseMe);
    await screen.findByText('Home');
    await userEvent.type(screen.getByLabelText('Unit name'), 'case');
    await userEvent.clear(screen.getByLabelText('Step'));
    await userEvent.type(screen.getByLabelText('Step'), '8');
    const unitForm = screen.getByLabelText('Unit name').closest('form')!;
    await userEvent.click(within(unitForm).getByRole('button', { name: 'Add' }));

    await vi.waitFor(() => {
      const createReq = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.url.endsWith('/units') && r.method === 'POST');
      expect(createReq).toBeDefined();
    });
    const createReq = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.url.endsWith('/units') && r.method === 'POST')!;
    const body = JSON.parse(await createReq.clone().text());
    expect(body.step).toBe(8);
  });

  it('empty step is omitted from the create request (server defaults to 1)', async () => {
    const { fetchMock } = renderSettings(baseMe);
    await screen.findByText('Home');
    await userEvent.type(screen.getByLabelText('Unit name'), 'case');
    await userEvent.clear(screen.getByLabelText('Step'));
    const unitForm = screen.getByLabelText('Unit name').closest('form')!;
    await userEvent.click(within(unitForm).getByRole('button', { name: 'Add' }));

    await vi.waitFor(() => {
      const createReq = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.url.endsWith('/units') && r.method === 'POST');
      expect(createReq).toBeDefined();
    });
    const createReq = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.url.endsWith('/units') && r.method === 'POST')!;
    const body = JSON.parse(await createReq.clone().text());
    expect('step' in body).toBe(false);
  });

  it('an invalid create step (0.001) is rejected locally: no POST, a message is shown', async () => {
    const { fetchMock } = renderSettings(baseMe);
    await screen.findByText('Home');
    await userEvent.type(screen.getByLabelText('Unit name'), 'case');
    await userEvent.clear(screen.getByLabelText('Step'));
    await userEvent.type(screen.getByLabelText('Step'), '0.001');
    const unitForm = screen.getByLabelText('Unit name').closest('form')!;
    await userEvent.click(within(unitForm).getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/step/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => url(c[0]).endsWith('/units') && (c[0] as Request).method === 'POST')).toBe(false);
  });

  it('shows the step for each custom unit and saves an edit on blur', async () => {
    const customUnit: UnitDto = { id: 'u-case', name: 'case', pluralName: null, abbreviation: null, global: false, step: 8 };
    const { fetchMock } = renderSettings(baseMe, { current: [customUnit] });
    await screen.findByText('Home');
    const stepInput = await screen.findByLabelText('Step for case');
    expect(stepInput).toHaveValue(8);
    await userEvent.clear(stepInput);
    await userEvent.type(stepInput, '5');
    stepInput.blur();

    await vi.waitFor(() => {
      const patchReq = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.url.includes('/units/u-case') && r.method === 'PATCH');
      expect(patchReq).toBeDefined();
    });
    const patchReq = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.url.includes('/units/u-case') && r.method === 'PATCH')!;
    const body = JSON.parse(await patchReq.clone().text());
    expect(body.step).toBe(5);
  });

  it('does not revert a background step change on an untouched blur, and saves exactly once when hand-edited', async () => {
    const customUnit: UnitDto = { id: 'u-case', name: 'case', pluralName: null, abbreviation: null, global: false, step: 8 };
    const unitsBox = { current: [customUnit] };
    const { fetchMock, store } = renderSettings(baseMe, unitsBox);
    await screen.findByText('Home');
    const stepInput = (await screen.findByLabelText('Step for case')) as HTMLInputElement;
    expect(stepInput).toHaveValue(8);

    // Another device changes the step to 5; a background refetch (e.g. refetchOnFocus) lands
    // while this field is idle (not focused, not hand-edited).
    unitsBox.current = [{ ...customUnit, step: 5 }];
    store.dispatch(api.util.invalidateTags(['Units']));
    await vi.waitFor(() => expect(stepInput).toHaveValue(5));

    // Focus + blur without typing must NOT write the stale 8 back.
    stepInput.focus();
    stepInput.blur();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock.mock.calls.some((c) => url(c[0]).includes('/units/u-case') && (c[0] as Request).method === 'PATCH')).toBe(false);
    expect(stepInput).toHaveValue(5);

    // Now a real edit still saves exactly once.
    await userEvent.clear(stepInput);
    await userEvent.type(stepInput, '6');
    stepInput.blur();
    await vi.waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter((c) => url(c[0]).includes('/units/u-case') && (c[0] as Request).method === 'PATCH');
      expect(patchCalls).toHaveLength(1);
    });
    const patchReq = fetchMock.mock.calls.map((c) => c[0] as Request).find((r) => r.url.includes('/units/u-case') && r.method === 'PATCH')!;
    const body = JSON.parse(await patchReq.clone().text());
    expect(body.step).toBe(6);
  });

  it('a locally rejected edit (e.g. 3 decimal places) reverts and toasts a reason', async () => {
    const customUnit: UnitDto = { id: 'u-case', name: 'case', pluralName: null, abbreviation: null, global: false, step: 8 };
    const { fetchMock } = renderSettings(baseMe, { current: [customUnit] });
    await screen.findByText('Home');
    const stepInput = (await screen.findByLabelText('Step for case')) as HTMLInputElement;
    await userEvent.clear(stepInput);
    await userEvent.type(stepInput, '5.125');
    stepInput.blur();

    await vi.waitFor(() => expect(stepInput).toHaveValue(8));
    expect(await screen.findByText(/decimal places/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => url(c[0]).includes('/units/u-case') && (c[0] as Request).method === 'PATCH')).toBe(false);
  });
});
