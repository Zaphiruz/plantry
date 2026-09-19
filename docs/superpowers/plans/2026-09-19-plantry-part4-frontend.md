# Plantry Plan — Part 4: Frontend (Tasks 19–25)

Index + Global Constraints: [2026-09-19-plantry.md](2026-09-19-plantry.md). Visual/structural reference: `D:\code\Velvet Scoop\website-v2\apps\frontend`.

Conventions for every task in this part:
- Mobile-first Tailwind. Tap targets ≥ 44 px (`min-h-11 min-w-11`). No component library beyond `@radix-ui/react-dialog`.
- All server state through RTK Query (`src/api.ts`). No `fetch` in components except the presigned S3 PUTs in Task 24.
- Every hook/endpoint takes `hid` explicitly — there is no "current household" in the store; it comes from the URL (`useParams`).
- Run the backend for manual checks with `pnpm --filter @plantry/backend dev` (dev bypass on) and log in at `http://localhost:5173/api/auth/dev-login?sub=me&name=Me&admin=1`.

---

### Task 19: Scaffold, API slice, auth gate, layout, picker, invite

**Files:**
- Create: `apps/frontend/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `tailwind.config.ts`, `postcss.config.cjs`, `index.html`, `public/favicon.svg`
- Create: `src/main.tsx`, `src/index.css`, `src/store.ts`, `src/api.ts`, `src/App.tsx`, `src/sw.ts` (minimal; push handlers come in Task 23), `src/test-setup.ts`
- Create: `src/lib/format.ts`, `src/components/Layout.tsx`, `src/components/Toast.tsx`, `src/pages/HouseholdPicker.tsx`, `src/pages/InviteAccept.tsx`
- Test: `src/lib/format.test.ts`, `src/components/Toast.test.tsx`

**Interfaces:**
- Consumes: every DTO/schema type from `@plantry/shared`; all backend routes.
- Produces:
  - `api` (RTK Query) exporting the hooks listed in Step 4 — later tasks use these names verbatim
  - `useToast(): { show(t: { message: string; actionLabel?: string; onAction?: () => void; durationMs?: number }): void }`, `<ToastProvider>`
  - `formatQty(n: number, unit: UnitDto): string`, `defaultWindowFor(periodDays: number, hasAutoDeduct: boolean): RateWindow`, `errorMessage(err: unknown): string`
  - `<Layout>` (header switcher, tabs with low-stock badge, offline banner + `<fieldset disabled>` wrapper, `<Outlet>`)

- [ ] **Step 1: Package + tool config**

`apps/frontend/package.json`:
```json
{
  "name": "@plantry/frontend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@plantry/shared": "workspace:*",
    "@radix-ui/react-dialog": "^1.1.2",
    "@reduxjs/toolkit": "^2.3.0",
    "@zxing/browser": "^0.1.5",
    "@zxing/library": "^0.21.3",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-redux": "^9.1.2",
    "react-router-dom": "^6.28.0",
    "workbox-precaching": "^7.3.0",
    "workbox-routing": "^7.3.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.2",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "autoprefixer": "^10.4.20",
    "jsdom": "^25.0.1",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vite-plugin-pwa": "^0.21.0",
    "vitest": "^2.1.5"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"], "module": "ESNext", "moduleResolution": "Bundler",
    "jsx": "react-jsx", "strict": true, "noUncheckedIndexedAccess": true, "skipLibCheck": true,
    "isolatedModules": true, "noEmit": true, "types": ["vite/client", "vite-plugin-pwa/client", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts", "e2e", "playwright.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Plantry', short_name: 'Plantry', description: 'Shared household inventory',
        theme_color: '#14532d', background_color: '#f8fafc', display: 'standalone', start_url: '/', scope: '/',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg}'] },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } } },
});
```
(`changeOrigin: false` keeps the browser's `Origin: http://localhost:5173`, which the backend's origin check requires.)

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], include: ['src/**/*.test.{ts,tsx}'] },
});
```
`src/test-setup.ts`: `import '@testing-library/jest-dom/vitest';`

`tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';
export default { content: ['./index.html', './src/**/*.{ts,tsx}'], theme: { extend: {} }, plugins: [] } satisfies Config;
```
`postcss.config.cjs`: `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };`

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#14532d" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/favicon.svg" />
    <title>Plantry</title>
  </head>
  <body class="bg-slate-50 text-slate-900">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```
`public/favicon.svg`:
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#14532d"/><path d="M32 50V26m0 0c0-9 6-14 14-14 0 9-5 14-14 14Zm0 6c0-7-5-11-12-11 0 7 5 11 12 11Z" fill="none" stroke="#bbf7d0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
```
`src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer components {
  .btn { @apply inline-flex min-h-11 items-center justify-center rounded-lg px-4 font-medium disabled:opacity-40; }
  .btn-primary { @apply btn bg-green-800 text-white active:bg-green-900; }
  .btn-ghost { @apply btn border border-slate-300 bg-white active:bg-slate-100; }
  .btn-danger { @apply btn bg-red-700 text-white active:bg-red-800; }
  .input { @apply min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3; }
  .card { @apply rounded-xl border border-slate-200 bg-white p-4; }
  .label { @apply mb-1 block text-sm font-medium text-slate-600; }
}
fieldset { @apply m-0 min-w-0 border-0 p-0; }
```

- [ ] **Step 2: Failing unit tests**

`src/lib/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { UnitDto } from '@plantry/shared';
import { defaultWindowFor, errorMessage, formatQty } from './format';

const unit = (p: Partial<UnitDto>): UnitDto => ({ id: 'u', name: 'can', pluralName: 'cans', abbreviation: null, global: true, ...p });

describe('formatQty', () => {
  it('pluralises, prefers abbreviations, trims trailing zeros', () => {
    expect(formatQty(1, unit({}))).toBe('1 can');
    expect(formatQty(2, unit({}))).toBe('2 cans');
    expect(formatQty(-3, unit({}))).toBe('-3 cans');
    expect(formatQty(1.5, unit({ name: 'lb', pluralName: 'lb', abbreviation: 'lb' }))).toBe('1.5 lb');
    expect(formatQty(2, unit({ pluralName: null }))).toBe('2 can');
  });
});

describe('defaultWindowFor', () => {
  it('is the smallest window ≥ 2× the auto-deduct period, else 30d', () => {
    expect(defaultWindowFor(1, true)).toBe('30d');
    expect(defaultWindowFor(90, true)).toBe('183d');
    expect(defaultWindowFor(100, true)).toBe('365d');
    expect(defaultWindowFor(400, true)).toBe('365d');
    expect(defaultWindowFor(90, false)).toBe('30d');
  });
});

describe('errorMessage', () => {
  it('reads the API envelope', () => {
    expect(errorMessage({ status: 409, data: { error: { code: 'last_owner', message: 'Assign another owner first' } } })).toBe('Assign another owner first');
    expect(errorMessage(new Error('x'))).toBe('Something went wrong');
  });
});
```

`src/components/Toast.test.tsx`:
```tsx
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function Trigger({ onUndo }: { onUndo: () => void }) {
  const toast = useToast();
  return <button onClick={() => toast.show({ message: 'Restocked 12', actionLabel: 'Undo', onAction: onUndo, durationMs: 5000 })}>go</button>;
}

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('runs the action once and dismisses', async () => {
    const onUndo = vi.fn();
    render(<ToastProvider><Trigger onUndo={onUndo} /></ToastProvider>);
    await userEvent.click(screen.getByText('go'));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Restocked 12')).toBeNull();
  });

  it('auto-dismisses after its duration', async () => {
    render(<ToastProvider><Trigger onUndo={() => {}} /></ToastProvider>);
    await userEvent.click(screen.getByText('go'));
    expect(screen.getByText('Restocked 12')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5100); });
    expect(screen.queryByText('Restocked 12')).toBeNull();
  });
});
```

Run: `pnpm install && pnpm --filter @plantry/frontend test` → FAIL (modules missing).

- [ ] **Step 3: `format.ts` and `Toast.tsx`**

`src/lib/format.ts`:
```ts
import { RATE_WINDOWS, windowDays, type RateWindow, type UnitDto } from '@plantry/shared';

export function formatQty(n: number, unit: UnitDto): string {
  const num = String(Math.round(n * 1000) / 1000);
  const label = unit.abbreviation ?? (Math.abs(n) === 1 ? unit.name : unit.pluralName ?? unit.name);
  return `${num} ${label}`;
}

export function defaultWindowFor(periodDays: number, hasAutoDeduct: boolean): RateWindow {
  if (!hasAutoDeduct) return '30d';
  return RATE_WINDOWS.find((w) => windowDays(w) >= periodDays * 2) ?? '365d';
}

export function errorMessage(err: unknown): string {
  const msg = (err as { data?: { error?: { message?: unknown } } })?.data?.error?.message;
  return typeof msg === 'string' ? msg : 'Something went wrong';
}
```

`src/components/Toast.tsx`:
```tsx
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ToastInput { message: string; actionLabel?: string; onAction?: () => void; durationMs?: number }
interface ToastApi { show(t: ToastInput): void }
const Ctx = createContext<ToastApi>({ show: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastInput | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const dismiss = useCallback(() => { clearTimeout(timer.current); setToast(null); }, []);
  const show = useCallback((t: ToastInput) => {
    clearTimeout(timer.current);
    setToast(t);
    timer.current = setTimeout(() => setToast(null), t.durationMs ?? 4000);
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {toast && (
        <div role="status" className="fixed inset-x-3 bottom-20 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-white shadow-lg">
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button className="min-h-11 px-2 font-semibold text-green-300" onClick={() => { toast.onAction?.(); dismiss(); }}>
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}
```

Run the two tests → PASS.

- [ ] **Step 4: API slice + store**

`src/api.ts`:
```ts
import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import type {
  EventsPageDto, FeedbackDto, HouseholdSummary, InviteDto, ItemCreateInput, ItemDto, ItemUpdateInput, MeDto, MemberDto, MemberRole,
  PhotoUploadDto, PurchaseResultDto, RateDto, RateWindow, ShoppingAddInput, ShoppingListDto, StoreDto, UnitDto,
} from '@plantry/shared';

// Absolute base so RTK's `new Request(url)` also works under Node/jsdom in tests.
const raw = fetchBaseQuery({ baseUrl: `${globalThis.location?.origin ?? ''}/api`, credentials: 'same-origin' });

/** Unwraps `{ data }`, and bounces to login on 401. */
const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extra) => {
  const result = await raw(args, api, extra);
  if (result.error?.status === 401 && !globalThis.location.pathname.startsWith('/api/')) {
    globalThis.location.assign('/api/auth/login');
  }
  if (result.data && typeof result.data === 'object' && 'data' in result.data) {
    return { ...result, data: (result.data as { data: unknown }).data };
  }
  return result;
};

type Hid = { hid: string };
const h = (hid: string) => `/households/${hid}`;
const STOCK_TAGS = ['Items', 'Shopping', 'Events', 'Rates'] as const;
interface StockResult { item: ItemDto; eventId: string | null }

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: ['Me', 'Members', 'Stores', 'Units', 'Items', 'Shopping', 'Events', 'Rates', 'Feedback'],
  endpoints: (b) => ({
    getMe: b.query<MeDto, void>({ query: () => '/me', providesTags: ['Me'] }),
    logout: b.mutation<{ endSessionUrl: string | null }, void>({ query: () => ({ url: '/auth/logout', method: 'POST' }) }),
    createHousehold: b.mutation<HouseholdSummary, { name: string }>({ query: (body) => ({ url: '/households', method: 'POST', body }), invalidatesTags: ['Me'] }),
    acceptInvite: b.mutation<HouseholdSummary, string>({ query: (token) => ({ url: `/invites/${encodeURIComponent(token)}/accept`, method: 'POST' }), invalidatesTags: ['Me'] }),

    renameHousehold: b.mutation<HouseholdSummary, Hid & { name: string }>({ query: ({ hid, name }) => ({ url: h(hid), method: 'PATCH', body: { name } }), invalidatesTags: ['Me'] }),
    getMembers: b.query<MemberDto[], string>({ query: (hid) => `${h(hid)}/members`, providesTags: ['Members'] }),
    setMemberRole: b.mutation<unknown, Hid & { sub: string; role: MemberRole }>({ query: ({ hid, sub, role }) => ({ url: `${h(hid)}/members/${encodeURIComponent(sub)}`, method: 'PATCH', body: { role } }), invalidatesTags: ['Members', 'Me'] }),
    removeMember: b.mutation<void, Hid & { sub: string }>({ query: ({ hid, sub }) => ({ url: `${h(hid)}/members/${encodeURIComponent(sub)}`, method: 'DELETE' }), invalidatesTags: ['Members'] }),
    leaveHousehold: b.mutation<void, string>({ query: (hid) => ({ url: `${h(hid)}/members/me`, method: 'DELETE' }), invalidatesTags: ['Me'] }),
    createInvite: b.mutation<InviteDto, string>({ query: (hid) => ({ url: `${h(hid)}/invites`, method: 'POST' }) }),

    getStores: b.query<StoreDto[], string>({ query: (hid) => `${h(hid)}/stores`, providesTags: ['Stores'] }),
    createStore: b.mutation<StoreDto, Hid & { name: string; notes?: string | null }>({ query: ({ hid, ...body }) => ({ url: `${h(hid)}/stores`, method: 'POST', body }), invalidatesTags: ['Stores'] }),
    updateStore: b.mutation<StoreDto, Hid & { id: string; name?: string; notes?: string | null }>({ query: ({ hid, id, ...body }) => ({ url: `${h(hid)}/stores/${id}`, method: 'PATCH', body }), invalidatesTags: ['Stores', 'Shopping'] }),
    deleteStore: b.mutation<void, Hid & { id: string }>({ query: ({ hid, id }) => ({ url: `${h(hid)}/stores/${id}`, method: 'DELETE' }), invalidatesTags: ['Stores', 'Items', 'Shopping'] }),

    getUnits: b.query<UnitDto[], string>({ query: (hid) => `${h(hid)}/units`, providesTags: ['Units'] }),
    createUnit: b.mutation<UnitDto, Hid & { name: string; pluralName?: string | null; abbreviation?: string | null }>({ query: ({ hid, ...body }) => ({ url: `${h(hid)}/units`, method: 'POST', body }), invalidatesTags: ['Units'] }),
    deleteUnit: b.mutation<void, Hid & { id: string }>({ query: ({ hid, id }) => ({ url: `${h(hid)}/units/${id}`, method: 'DELETE' }), invalidatesTags: ['Units', 'Items'] }),

    getInventory: b.query<ItemDto[], string>({ query: (hid) => `${h(hid)}/inventory`, providesTags: ['Items'] }),
    getArchivedItems: b.query<ItemDto[], string>({ query: (hid) => `${h(hid)}/items?archived=true`, providesTags: ['Items'] }),
    findByBarcode: b.query<ItemDto[], Hid & { barcode: string }>({ query: ({ hid, barcode }) => `${h(hid)}/items?barcode=${encodeURIComponent(barcode)}` }),
    getItem: b.query<ItemDto, Hid & { id: string }>({ query: ({ hid, id }) => `${h(hid)}/items/${id}`, providesTags: ['Items'] }),
    createItem: b.mutation<ItemDto, Hid & { body: Partial<ItemCreateInput> & { name: string; unitId: string } }>({ query: ({ hid, body }) => ({ url: `${h(hid)}/items`, method: 'POST', body }), invalidatesTags: [...STOCK_TAGS] }),
    updateItem: b.mutation<ItemDto, Hid & { id: string; body: ItemUpdateInput }>({ query: ({ hid, id, body }) => ({ url: `${h(hid)}/items/${id}`, method: 'PATCH', body }), invalidatesTags: [...STOCK_TAGS] }),
    archiveItem: b.mutation<ItemDto, Hid & { id: string }>({ query: ({ hid, id }) => ({ url: `${h(hid)}/items/${id}/archive`, method: 'POST' }), invalidatesTags: [...STOCK_TAGS] }),
    unarchiveItem: b.mutation<ItemDto, Hid & { id: string }>({ query: ({ hid, id }) => ({ url: `${h(hid)}/items/${id}/unarchive`, method: 'POST' }), invalidatesTags: [...STOCK_TAGS] }),
    deleteItem: b.mutation<void, Hid & { id: string }>({ query: ({ hid, id }) => ({ url: `${h(hid)}/items/${id}`, method: 'DELETE' }), invalidatesTags: [...STOCK_TAGS] }),
    consolidate: b.mutation<ItemDto, Hid & { targetId: string; sourceId: string; keepMinStockFrom: 'target' | 'source' }>({ query: ({ hid, targetId, ...body }) => ({ url: `${h(hid)}/items/${targetId}/consolidate`, method: 'POST', body }), invalidatesTags: [...STOCK_TAGS] }),

    restock: b.mutation<StockResult, Hid & { itemId: string; quantity: number }>({
      query: ({ hid, itemId, quantity }) => ({ url: `${h(hid)}/inventory/${itemId}/restock`, method: 'POST', body: { quantity } }),
      invalidatesTags: [...STOCK_TAGS],
      onQueryStarted: (arg, ctx) => optimisticCount(arg.hid, arg.itemId, arg.quantity, ctx),
    }),
    consume: b.mutation<StockResult, Hid & { itemId: string; quantity: number }>({
      query: ({ hid, itemId, quantity }) => ({ url: `${h(hid)}/inventory/${itemId}/consume`, method: 'POST', body: { quantity } }),
      invalidatesTags: [...STOCK_TAGS],
      onQueryStarted: (arg, ctx) => optimisticCount(arg.hid, arg.itemId, -arg.quantity, ctx),
    }),
    adjust: b.mutation<StockResult, Hid & { itemId: string; newCount: number }>({ query: ({ hid, itemId, newCount }) => ({ url: `${h(hid)}/inventory/${itemId}/adjust`, method: 'POST', body: { newCount } }), invalidatesTags: [...STOCK_TAGS] }),
    undoEvent: b.mutation<void, Hid & { eventId: string }>({ query: ({ hid, eventId }) => ({ url: `${h(hid)}/inventory/events/${eventId}`, method: 'DELETE' }), invalidatesTags: [...STOCK_TAGS] }),
    getEvents: b.query<EventsPageDto, Hid & { itemId: string; cursor?: string }>({ query: ({ hid, itemId, cursor }) => `${h(hid)}/inventory/${itemId}/events${cursor ? `?cursor=${cursor}` : ''}`, providesTags: ['Events'] }),
    getRate: b.query<RateDto, Hid & { id: string; window: RateWindow }>({ query: ({ hid, id, window }) => `${h(hid)}/items/${id}/consumption-rate?window=${window}`, providesTags: ['Rates'] }),

    getShoppingList: b.query<ShoppingListDto, string>({ query: (hid) => `${h(hid)}/shopping-list`, providesTags: ['Shopping'] }),
    purchase: b.mutation<PurchaseResultDto, Hid & { itemId: string; quantity?: number }>({ query: ({ hid, itemId, quantity }) => ({ url: `${h(hid)}/shopping-list/items/${itemId}/purchase`, method: 'POST', body: quantity === undefined ? {} : { quantity } }), invalidatesTags: [...STOCK_TAGS] }),
    addToList: b.mutation<{ id: string }, Hid & { body: ShoppingAddInput }>({ query: ({ hid, body }) => ({ url: `${h(hid)}/shopping-list-items`, method: 'POST', body }), invalidatesTags: ['Shopping', 'Items'] }),
    checkListRow: b.mutation<unknown, Hid & { id: string; checkedOff: boolean }>({ query: ({ hid, id, checkedOff }) => ({ url: `${h(hid)}/shopping-list-items/${id}`, method: 'PATCH', body: { checkedOff } }), invalidatesTags: ['Shopping'] }),
    removeListRow: b.mutation<void, Hid & { id: string }>({ query: ({ hid, id }) => ({ url: `${h(hid)}/shopping-list-items/${id}`, method: 'DELETE' }), invalidatesTags: ['Shopping', 'Items'] }),

    photoUploadUrl: b.mutation<PhotoUploadDto, Hid & { id: string; sizeBytes: number; thumbSizeBytes: number }>({ query: ({ hid, id, ...sizes }) => ({ url: `${h(hid)}/items/${id}/photo/upload-url`, method: 'POST', body: { mimeType: 'image/jpeg', ...sizes } }) }),
    photoFinalize: b.mutation<ItemDto, Hid & { id: string; key: string }>({ query: ({ hid, id, key }) => ({ url: `${h(hid)}/items/${id}/photo/finalize`, method: 'POST', body: { key } }), invalidatesTags: ['Items', 'Shopping'] }),
    photoDelete: b.mutation<void, Hid & { id: string }>({ query: ({ hid, id }) => ({ url: `${h(hid)}/items/${id}/photo`, method: 'DELETE' }), invalidatesTags: ['Items', 'Shopping'] }),

    getVapidKey: b.query<{ publicKey: string | null }, void>({ query: () => '/push/vapid-key' }),
    pushSubscribe: b.mutation<void, { endpoint: string; keys: { p256dh: string; auth: string } }>({ query: (body) => ({ url: '/push/subscriptions', method: 'POST', body }) }),
    pushUnsubscribe: b.mutation<void, { endpoint: string }>({ query: (body) => ({ url: '/push/subscriptions', method: 'DELETE', body }) }),

    getMyFeedback: b.query<FeedbackDto[], void>({ query: () => '/feedback/mine', providesTags: ['Feedback'] }),
    sendFeedback: b.mutation<{ issueNumber: number; issueUrl: string }, { body: string; pageUrl?: string }>({ query: (body) => ({ url: '/feedback', method: 'POST', body }), invalidatesTags: ['Feedback'] }),
  }),
});

/** Optimistically bumps the count in the cached inventory list; rolls back if the request fails. */
async function optimisticCount(
  hid: string, itemId: string, delta: number,
  { dispatch, queryFulfilled }: { dispatch: (a: any) => any; queryFulfilled: Promise<unknown> },
): Promise<void> {
  const patch = dispatch(api.util.updateQueryData('getInventory', hid, (draft) => {
    const item = draft.find((i) => i.id === itemId);
    if (!item) return;
    item.currentCount = Math.round((item.currentCount + delta) * 1000) / 1000;
    item.low = item.currentCount <= item.minStock;
  }));
  try { await queryFulfilled; } catch { patch.undo(); }
}

export const {
  useGetMeQuery, useLogoutMutation, useCreateHouseholdMutation, useAcceptInviteMutation, useRenameHouseholdMutation,
  useGetMembersQuery, useSetMemberRoleMutation, useRemoveMemberMutation, useLeaveHouseholdMutation, useCreateInviteMutation,
  useGetStoresQuery, useCreateStoreMutation, useUpdateStoreMutation, useDeleteStoreMutation,
  useGetUnitsQuery, useCreateUnitMutation, useDeleteUnitMutation,
  useGetInventoryQuery, useGetArchivedItemsQuery, useLazyFindByBarcodeQuery, useGetItemQuery, useCreateItemMutation, useUpdateItemMutation,
  useArchiveItemMutation, useUnarchiveItemMutation, useDeleteItemMutation, useConsolidateMutation,
  useRestockMutation, useConsumeMutation, useAdjustMutation, useUndoEventMutation, useGetEventsQuery, useGetRateQuery,
  useGetShoppingListQuery, usePurchaseMutation, useAddToListMutation, useCheckListRowMutation, useRemoveListRowMutation,
  usePhotoUploadUrlMutation, usePhotoFinalizeMutation, usePhotoDeleteMutation,
  useGetVapidKeyQuery, usePushSubscribeMutation, usePushUnsubscribeMutation, useGetMyFeedbackQuery, useSendFeedbackMutation,
} = api;
```

`src/store.ts`:
```ts
import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { api } from './api';

export const makeStore = () => configureStore({ reducer: { [api.reducerPath]: api.reducer }, middleware: (gdm) => gdm().concat(api.middleware) });
export const store = makeStore();
setupListeners(store.dispatch); // refetchOnFocus/Reconnect → also refreshes expiring presigned image URLs
```

- [ ] **Step 5: Shell — main, App, Layout, picker, invite, minimal SW**

`src/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { store } from './store';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}><BrowserRouter><ToastProvider><App /></ToastProvider></BrowserRouter></Provider>
  </React.StrictMode>,
);
```

`src/App.tsx`:
```tsx
import { Route, Routes } from 'react-router-dom';
import { useGetMeQuery } from './api';
import { Layout } from './components/Layout';
import { HouseholdPicker } from './pages/HouseholdPicker';
import { InviteAccept } from './pages/InviteAccept';

const Placeholder = ({ name }: { name: string }) => <p className="p-4 text-slate-500">{name} — coming in a later task</p>;

export function App() {
  const { data: me, isLoading } = useGetMeQuery();
  if (isLoading || !me) return <p className="p-8 text-center text-slate-500">Loading…</p>; // a 401 redirects inside baseQuery
  return (
    <Routes>
      <Route path="/" element={<HouseholdPicker />} />
      <Route path="/invite/:token" element={<InviteAccept />} />
      <Route path="/h/:hid" element={<Layout />}>
        <Route index element={<Placeholder name="Inventory" />} />
        <Route path="items/new" element={<Placeholder name="New item" />} />
        <Route path="items/:id" element={<Placeholder name="Item" />} />
        <Route path="items/:id/edit" element={<Placeholder name="Edit item" />} />
        <Route path="shopping" element={<Placeholder name="Shopping" />} />
        <Route path="settings" element={<Placeholder name="Settings" />} />
      </Route>
      <Route path="*" element={<HouseholdPicker />} />
    </Routes>
  );
}
```

`src/components/Layout.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useGetInventoryQuery, useGetMeQuery } from '../api';

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export function Layout() {
  const { hid = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const { data: me } = useGetMeQuery();
  const { data: items } = useGetInventoryQuery(hid);
  if (me && !me.households.some((h) => h.id === hid)) return <Navigate to="/" replace />;
  const lowCount = items?.filter((i) => i.low).length ?? 0;
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-14 flex-1 items-center justify-center gap-1 text-sm font-medium ${isActive ? 'text-green-800' : 'text-slate-500'}`;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="font-bold text-green-900">Plantry</span>
        <select aria-label="Household" className="input ml-auto max-w-[60%]" value={hid}
          onChange={(e) => navigate(e.target.value === '__all' ? '/' : `/h/${e.target.value}`)}>
          {me?.households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          <option value="__all">All households…</option>
        </select>
      </header>
      {!online && <div role="alert" className="bg-amber-100 px-3 py-2 text-center text-sm text-amber-900">You're offline — changes are disabled until you reconnect.</div>}
      <main className="flex-1 pb-20">
        <fieldset disabled={!online}><Outlet /></fieldset>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-2xl border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <NavLink to={`/h/${hid}`} end className={tab}>Inventory</NavLink>
        <NavLink to={`/h/${hid}/shopping`} className={tab}>
          Shopping{lowCount > 0 && <span className="rounded-full bg-red-600 px-2 text-xs text-white">{lowCount}</span>}
        </NavLink>
        <NavLink to={`/h/${hid}/settings`} className={tab}>Settings</NavLink>
      </nav>
    </div>
  );
}
```

`src/pages/HouseholdPicker.tsx`:
```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateHouseholdMutation, useGetMeQuery } from '../api';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/format';

export function HouseholdPicker() {
  const { data: me } = useGetMeQuery();
  const [create, { isLoading }] = useCreateHouseholdMutation();
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  return (
    <div className="mx-auto max-w-md space-y-6 p-4">
      <h1 className="text-2xl font-bold text-green-900">Plantry</h1>
      <p className="text-slate-600">Hi {me?.user.name}. Pick a household:</p>
      <ul className="space-y-2">
        {me?.households.map((h) => (
          <li key={h.id}><Link className="card flex min-h-14 items-center justify-between" to={`/h/${h.id}`}><span className="font-medium">{h.name}</span><span className="text-sm text-slate-500">{h.role}</span></Link></li>
        ))}
        {me?.households.length === 0 && <li className="text-slate-500">You're not in any household yet.</li>}
      </ul>
      <form className="card space-y-2" onSubmit={async (e) => {
        e.preventDefault();
        try { const h = await create({ name }).unwrap(); navigate(`/h/${h.id}`); } catch (err) { toast.show({ message: errorMessage(err) }); }
      }}>
        <label className="label" htmlFor="hh-name">Create a household</label>
        <input id="hh-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Casa" required maxLength={120} />
        <button className="btn-primary w-full" disabled={isLoading}>Create</button>
      </form>
      <form className="card space-y-2" onSubmit={(e) => {
        e.preventDefault();
        const token = invite.trim().split('/invite/').pop();
        if (token) navigate(`/invite/${token}`);
      }}>
        <label className="label" htmlFor="invite">Have an invite link?</label>
        <input id="invite" className="input" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Paste it here" />
        <button className="btn-ghost w-full">Join</button>
      </form>
    </div>
  );
}
```

`src/pages/InviteAccept.tsx`:
```tsx
import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAcceptInviteMutation } from '../api';
import { errorMessage } from '../lib/format';

export function InviteAccept() {
  const { token = '' } = useParams();
  const [accept, { error }] = useAcceptInviteMutation();
  const navigate = useNavigate();
  const started = useRef(false); // StrictMode double-invokes effects; the endpoint is idempotent but don't race it
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    accept(token).unwrap().then((h) => navigate(`/h/${h.id}`, { replace: true })).catch(() => {});
  }, [accept, navigate, token]);
  if (!error) return <p className="p-8 text-center text-slate-500">Joining…</p>;
  return <div className="space-y-4 p-8 text-center"><p>{errorMessage(error)}</p><Link className="btn-ghost" to="/">Back</Link></div>;
}
```

`src/sw.ts` (minimal for now):
```ts
/// <reference lib="webworker" />
import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));
self.addEventListener('install', () => { void self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
```

- [ ] **Step 6: Verify**

```bash
pnpm --filter @plantry/frontend test && pnpm --filter @plantry/frontend typecheck && pnpm --filter @plantry/frontend build
pnpm dev
```
Manual: dev-login → picker shows → create "Casa" → lands on `/h/<id>` with header switcher and three tabs → "All households…" returns to picker. In a second browser profile log in as another sub, create an invite via `curl` or wait for Task 23; paste-link flow is verified there.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(frontend): PWA scaffold, API slice, auth gate, layout, household picker, invite accept"
```

---

### Task 20: Inventory screen, steppers, optimistic updates

**Files:**
- Create: `src/lib/useLongPress.ts`, `src/components/QtyDialog.tsx`, `src/components/ItemRow.tsx`, `src/pages/Inventory.tsx`
- Modify: `src/App.tsx` (swap the Inventory placeholder)
- Test: `src/api.optimistic.test.ts`

**Interfaces:**
- Consumes: `useGetInventoryQuery`, `useConsumeMutation`, `useRestockMutation`, `useUndoEventMutation`, `useAddToListMutation`, `useRemoveListRowMutation`, `useToast`, `formatQty`.
- Produces: `useLongPress(onLongPress: () => void, onClick: () => void, ms = 500)` → pointer handlers; `<QtyDialog open title initial unitLabel onConfirm(n) onClose />`; `<ItemRow hid item />`.

- [ ] **Step 1: Failing optimistic-rollback test**

`src/api.optimistic.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemDto } from '@plantry/shared';
import { api } from './api';
import { makeStore } from './store';

const item = { id: 'i1', name: 'Rice', currentCount: 3, minStock: 2, low: false } as ItemDto;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('optimistic stepper', () => {
  it('applies the delta immediately, flips `low`, and rolls back when the server rejects', async () => {
    let failConsume!: () => void;
    vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
      if (req.url.endsWith('/inventory')) return json({ data: [item] });
      await new Promise<void>((r) => { failConsume = r; });
      return json({ error: { code: 'internal', message: 'nope' } }, 500);
    }));
    const store = makeStore();
    await store.dispatch(api.endpoints.getInventory.initiate('h1'));
    const read = () => api.endpoints.getInventory.select('h1')(store.getState()).data![0]!;

    const pending = store.dispatch(api.endpoints.consume.initiate({ hid: 'h1', itemId: 'i1', quantity: 1 }));
    await vi.waitFor(() => expect(read().currentCount).toBe(2));
    expect(read().low).toBe(true);

    failConsume();
    await pending;
    expect(read().currentCount).toBe(3);
    expect(read().low).toBe(false);
  });
});
```

Run → it should already PASS against Task 19's `optimisticCount` (this test pins the behaviour). If it fails, fix `api.ts`, not the test.

- [ ] **Step 2: `useLongPress` + `QtyDialog`**

`src/lib/useLongPress.ts`:
```ts
import { useRef } from 'react';

/** Tap → onClick; hold ≥ ms → onLongPress (and the tap is swallowed). Moving the pointer away cancels both. */
export function useLongPress(onLongPress: () => void, onClick: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fired = useRef(false);
  const clear = () => clearTimeout(timer.current);
  return {
    onPointerDown: () => { fired.current = false; timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, ms); },
    onPointerUp: () => { clear(); if (!fired.current) onClick(); },
    onPointerLeave: () => { clear(); fired.current = true; },
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  };
}
```

`src/components/QtyDialog.tsx`:
```tsx
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';

interface Props { open: boolean; title: string; initial: number; unitLabel: string; allowNegative?: boolean; onConfirm(n: number): void; onClose(): void }

export function QtyDialog({ open, title, initial, unitLabel, allowNegative, onConfirm, onClose }: Props) {
  const [value, setValue] = useState(String(initial));
  useEffect(() => { if (open) setValue(String(initial)); }, [open, initial]);
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(n) && (allowNegative || n > 0);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed inset-x-4 top-1/4 z-50 mx-auto max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (valid) { onConfirm(n); onClose(); } }}>
            <label className="flex items-center gap-2">
              <input autoFocus className="input" type="number" inputMode="decimal" step="0.001" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Quantity" />
              <span className="text-slate-500">{unitLabel}</span>
            </label>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
              <button className="btn-primary flex-1" disabled={!valid}>OK</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 3: `ItemRow` + `Inventory`**

`src/components/ItemRow.tsx`:
```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ItemDto } from '@plantry/shared';
import { useAddToListMutation, useConsumeMutation, useRemoveListRowMutation, useRestockMutation, useUndoEventMutation } from '../api';
import { errorMessage, formatQty } from '../lib/format';
import { useLongPress } from '../lib/useLongPress';
import { QtyDialog } from './QtyDialog';
import { useToast } from './Toast';

export function ItemRow({ hid, item }: { hid: string; item: ItemDto }) {
  const [consume] = useConsumeMutation();
  const [restock] = useRestockMutation();
  const [undo] = useUndoEventMutation();
  const [addToList] = useAddToListMutation();
  const [removeRow] = useRemoveListRowMutation();
  const [dialog, setDialog] = useState<null | 'consume' | 'restock'>(null);
  const toast = useToast();
  const unitLabel = item.unit.abbreviation ?? item.unit.pluralName ?? item.unit.name;

  const act = async (kind: 'consume' | 'restock', quantity: number) => {
    try {
      const r = await (kind === 'consume' ? consume : restock)({ hid, itemId: item.id, quantity }).unwrap();
      toast.show({
        message: `${kind === 'consume' ? 'Used' : 'Added'} ${formatQty(quantity, item.unit)} · ${item.name}`,
        actionLabel: 'Undo', onAction: () => r.eventId && undo({ hid, eventId: r.eventId }), durationMs: 6000,
      });
    } catch (err) { toast.show({ message: errorMessage(err) }); }
  };
  const minus = useLongPress(() => setDialog('consume'), () => void act('consume', 1));
  const plus = useLongPress(() => setDialog('restock'), () => void act('restock', 1));
  const toggleTrip = async () => {
    try {
      if (item.nextTripRowId) await removeRow({ hid, id: item.nextTripRowId }).unwrap();
      else await addToList({ hid, body: { itemId: item.id } }).unwrap();
    } catch (err) { toast.show({ message: errorMessage(err) }); }
  };

  return (
    <li className="flex items-center gap-2 border-b border-slate-100 bg-white px-3 py-2">
      <Link to={`/h/${hid}/items/${item.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {item.thumbUrl
          ? <img src={item.thumbUrl} alt="" className="h-11 w-11 rounded-lg object-cover" loading="lazy" />
          : <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-400">{item.name[0]?.toUpperCase()}</span>}
        <span className="min-w-0">
          <span className="block truncate font-medium">{item.name}</span>
          <span className={`text-sm ${item.low ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
            {formatQty(item.currentCount, item.unit)}{item.low && ' · low'}
          </span>
        </span>
      </Link>
      <button type="button" aria-label={item.nextTripRowId ? `Remove ${item.name} from next trip` : `Add ${item.name} to next trip`} aria-pressed={!!item.nextTripRowId}
        className={`min-h-11 min-w-11 rounded-lg text-xl ${item.nextTripRowId ? 'bg-green-100 text-green-800' : 'text-slate-400'}`} onClick={toggleTrip}>🛒</button>
      <button type="button" aria-label={`Use 1 ${item.name}`} className="btn-ghost min-w-11 px-0 text-xl" {...minus}>−</button>
      <button type="button" aria-label={`Add 1 ${item.name}`} className="btn-ghost min-w-11 px-0 text-xl" {...plus}>+</button>
      <QtyDialog open={dialog !== null} title={dialog === 'consume' ? `Use ${item.name}` : `Restock ${item.name}`}
        initial={dialog === 'restock' ? item.defaultRestockQty : 1} unitLabel={unitLabel}
        onConfirm={(n) => dialog && void act(dialog, n)} onClose={() => setDialog(null)} />
    </li>
  );
}
```
(Spec §7 said "swipe → add to next trip"; this plan deliberately uses an always-visible 🛒 toggle instead — discoverable, accessible, and no gesture conflicts with list scrolling. The spec is updated to match.)

`src/pages/Inventory.tsx`:
```tsx
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGetInventoryQuery } from '../api';
import { ItemRow } from '../components/ItemRow';

export function Inventory() {
  const { hid = '' } = useParams();
  const { data: items, isLoading } = useGetInventoryQuery(hid);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(false);

  const categories = useMemo(() => [...new Set((items ?? []).map((i) => i.category).filter((c): c is string => !!c))].sort(), [items]);
  const shown = (items ?? []).filter((i) =>
    (!q || i.name.toLowerCase().includes(q.toLowerCase())) && (!category || i.category === category) && (!lowOnly || i.low));
  const chip = (active: boolean) => `min-h-9 whitespace-nowrap rounded-full border px-3 text-sm ${active ? 'border-green-800 bg-green-800 text-white' : 'border-slate-300 bg-white'}`;

  return (
    <div>
      <div className="sticky top-[57px] z-20 space-y-2 bg-slate-50 p-3">
        <div className="flex gap-2" id="inventory-toolbar">
          <input className="input" type="search" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
          <Link to={`/h/${hid}/items/new`} className="btn-primary whitespace-nowrap">+ New</Link>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <button type="button" className={chip(lowOnly)} onClick={() => setLowOnly((v) => !v)}>Low</button>
          {categories.map((c) => <button type="button" key={c} className={chip(category === c)} onClick={() => setCategory(category === c ? null : c)}>{c}</button>)}
        </div>
      </div>
      {isLoading && <p className="p-4 text-slate-500">Loading…</p>}
      {items && items.length === 0 && <p className="p-8 text-center text-slate-500">Nothing here yet. Add your first item.</p>}
      <ul>{shown.map((i) => <ItemRow key={i.id} hid={hid} item={i} />)}</ul>
    </div>
  );
}
```

In `App.tsx` replace the index placeholder with `<Inventory />` (import it).

- [ ] **Step 4: Verify + commit**

```bash
pnpm --filter @plantry/frontend test && pnpm --filter @plantry/frontend typecheck
```
Manual (create an item via `curl` or wait for Task 21's form — quickest: `POST /api/households/<hid>/items` from the browser console with `fetch`): − / + change the count instantly, toast shows Undo and Undo restores; hold + opens the quantity dialog pre-filled with the default restock quantity; 🛒 toggles; going offline in DevTools shows the banner and disables the buttons.

```bash
git add -A && git commit -m "feat(frontend): inventory list with optimistic steppers, undo, next-trip toggle"
```

---

### Task 21: Item form + item detail

**Files:**
- Create: `src/pages/ItemForm.tsx`, `src/pages/ItemDetail.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useGetItemQuery`, `useCreateItemMutation`, `useUpdateItemMutation`, `useGetStoresQuery`, `useGetUnitsQuery`, `useGetInventoryQuery`, `useGetRateQuery`, `useGetEventsQuery`, `useAdjustMutation`, `useArchiveItemMutation`, `useUnarchiveItemMutation`, `useDeleteItemMutation`, `useConsolidateMutation`, `useAddToListMutation`, `useRemoveListRowMutation`, `useGetMeQuery`, `QtyDialog`, `formatQty`, `defaultWindowFor`, `RATE_WINDOWS`.
- Produces: `<ItemForm />` (handles both `/items/new?barcode=` and `/items/:id/edit`), `<ItemDetail />` with a `photoSlot` placeholder `<div id="photo-slot" />` that Task 24 fills.

- [ ] **Step 1: `ItemForm`**

`src/pages/ItemForm.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCreateItemMutation, useGetItemQuery, useGetStoresQuery, useGetUnitsQuery, useUpdateItemMutation } from '../api';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/format';

interface FormState {
  name: string; description: string; category: string; unitId: string; preferredStoreId: string; barcode: string;
  currentCount: string; minStock: string; defaultRestockQty: string; renotifyAfterDays: string;
  autoOn: boolean; autoQty: string; autoPeriod: string; autoPaused: boolean;
}
const EMPTY: FormState = {
  name: '', description: '', category: '', unitId: '', preferredStoreId: '', barcode: '', currentCount: '0', minStock: '0',
  defaultRestockQty: '1', renotifyAfterDays: '7', autoOn: false, autoQty: '1', autoPeriod: '1', autoPaused: false,
};

export function ItemForm() {
  const { hid = '', id } = useParams();
  const [params] = useSearchParams();
  const editing = !!id;
  const { data: existing } = useGetItemQuery({ hid, id: id ?? '' }, { skip: !editing });
  const { data: stores } = useGetStoresQuery(hid);
  const { data: units } = useGetUnitsQuery(hid);
  const [createItem, createState] = useCreateItemMutation();
  const [updateItem, updateState] = useUpdateItemMutation();
  const [f, setF] = useState<FormState>({ ...EMPTY, barcode: params.get('barcode') ?? '' });
  const navigate = useNavigate();
  const toast = useToast();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!existing) return;
    setF({
      name: existing.name, description: existing.description ?? '', category: existing.category ?? '', unitId: existing.unit.id,
      preferredStoreId: existing.preferredStoreId ?? '', barcode: existing.barcode ?? '', currentCount: String(existing.currentCount),
      minStock: String(existing.minStock), defaultRestockQty: String(existing.defaultRestockQty), renotifyAfterDays: String(existing.renotifyAfterDays),
      autoOn: existing.autoDeductQty !== null, autoQty: String(existing.autoDeductQty ?? 1), autoPeriod: String(existing.autoDeductPeriodDays),
      autoPaused: existing.autoDeductPaused,
    });
  }, [existing]);
  useEffect(() => {
    if (!editing && !f.unitId && units) set('unitId', units.find((u) => u.global && u.name === 'each')?.id ?? units[0]?.id ?? '');
  }, [editing, f.unitId, units]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const common = {
      name: f.name, description: f.description || null, category: f.category || null, unitId: f.unitId,
      preferredStoreId: f.preferredStoreId || null, barcode: f.barcode || null, minStock: Number(f.minStock),
      defaultRestockQty: Number(f.defaultRestockQty), renotifyAfterDays: Number(f.renotifyAfterDays),
      autoDeductQty: f.autoOn ? Number(f.autoQty) : null, autoDeductPeriodDays: Number(f.autoPeriod), autoDeductPaused: f.autoOn && f.autoPaused,
    };
    try {
      const saved = editing
        ? await updateItem({ hid, id: id!, body: common }).unwrap()
        : await createItem({ hid, body: { ...common, currentCount: Number(f.currentCount) } }).unwrap();
      navigate(`/h/${hid}/items/${saved.id}`, { replace: true });
    } catch (err) { toast.show({ message: errorMessage(err) }); }
  };

  const num = (k: keyof FormState, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block"><span className="label">{label}</span>
      <input className="input" type="number" inputMode="decimal" step="0.001" value={f[k] as string} onChange={(e) => set(k, e.target.value as never)} required {...extra} /></label>
  );

  return (
    <form className="space-y-4 p-4" onSubmit={submit}>
      <h1 className="text-xl font-semibold">{editing ? 'Edit item' : 'New item'}</h1>
      <label className="block"><span className="label">Name</span><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} autoFocus={!editing} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Unit</span>
          <select className="input" value={f.unitId} onChange={(e) => set('unitId', e.target.value)} required>
            {units?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select></label>
        <label className="block"><span className="label">Preferred store</span>
          <select className="input" value={f.preferredStoreId} onChange={(e) => set('preferredStoreId', e.target.value)}>
            <option value="">Any store</option>{stores?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        {!editing && num('currentCount', 'Have now', { min: undefined })}
        {num('minStock', 'Minimum to keep', { min: 0 })}
        {num('defaultRestockQty', 'Usually buy', { min: 0.001 })}
        {num('renotifyAfterDays', 'Re-remind every (days)', { min: 1, max: 365, step: 1, inputMode: 'numeric' })}
      </div>
      <label className="block"><span className="label">Category</span><input className="input" value={f.category} onChange={(e) => set('category', e.target.value)} maxLength={60} placeholder="e.g. Pets" /></label>
      <label className="block"><span className="label">Barcode</span><input className="input" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} maxLength={64} inputMode="numeric" /></label>
      <label className="block"><span className="label">Notes</span><textarea className="input min-h-20 py-2" value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} /></label>

      <fieldset className="card space-y-3">
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.autoOn} onChange={(e) => set('autoOn', e.target.checked)} /><span className="font-medium">Uses itself up automatically</span></label>
        {f.autoOn && (<>
          <div className="flex flex-wrap items-center gap-2">
            <span>Uses</span><input aria-label="Amount used per period" className="input w-24" type="number" inputMode="decimal" step="0.001" min={0.001} value={f.autoQty} onChange={(e) => set('autoQty', e.target.value)} required />
            <span>every</span><input aria-label="Period in days" className="input w-24" type="number" inputMode="numeric" step={1} min={1} max={3650} value={f.autoPeriod} onChange={(e) => set('autoPeriod', e.target.value)} required />
            <span>day(s)</span>
          </div>
          <p className="text-sm text-slate-500">e.g. 2 every 1 day for cat food, or 1 every 90 days for a water filter. Changing this restarts the clock from today.</p>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.autoPaused} onChange={(e) => set('autoPaused', e.target.checked)} />Paused</label>
        </>)}
      </fieldset>

      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={() => navigate(-1)}>Cancel</button>
        <button className="btn-primary flex-1" disabled={createState.isLoading || updateState.isLoading}>Save</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: `ItemDetail`**

`src/pages/ItemDetail.tsx`:
```tsx
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RATE_WINDOWS, type RateWindow } from '@plantry/shared';
import {
  useAddToListMutation, useAdjustMutation, useArchiveItemMutation, useConsolidateMutation, useDeleteItemMutation, useGetEventsQuery,
  useGetInventoryQuery, useGetItemQuery, useGetMeQuery, useGetRateQuery, useRemoveListRowMutation, useUnarchiveItemMutation,
} from '../api';
import { QtyDialog } from '../components/QtyDialog';
import { useToast } from '../components/Toast';
import { defaultWindowFor, errorMessage, formatQty } from '../lib/format';

const EVENT_LABEL = { restock: 'Restocked', consume: 'Used', adjust: 'Adjusted', auto_deduct: 'Auto-used' } as const;

export function ItemDetail() {
  const { hid = '', id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: me } = useGetMeQuery();
  const { data: item } = useGetItemQuery({ hid, id });
  const { data: others } = useGetInventoryQuery(hid);
  const [window, setWindow] = useState<RateWindow | null>(null);
  const effectiveWindow = window ?? defaultWindowFor(item?.autoDeductPeriodDays ?? 1, item?.autoDeductQty != null);
  const { data: rate } = useGetRateQuery({ hid, id, window: effectiveWindow }, { skip: !item || !!item.archivedAt });
  const [cursor, setCursor] = useState<string | undefined>();
  const { data: events } = useGetEventsQuery({ hid, itemId: id, ...(cursor ? { cursor } : {}) });
  const [adjust] = useAdjustMutation(); const [archive] = useArchiveItemMutation(); const [unarchive] = useUnarchiveItemMutation();
  const [del] = useDeleteItemMutation(); const [consolidate] = useConsolidateMutation();
  const [addToList] = useAddToListMutation(); const [removeRow] = useRemoveListRowMutation();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState(''); const [keepMin, setKeepMin] = useState<'target' | 'source'>('target');

  if (!item) return <p className="p-4 text-slate-500">Loading…</p>;
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { try { await fn(); after?.(); } catch (err) { toast.show({ message: errorMessage(err) }); } };
  const unitLabel = item.unit.abbreviation ?? item.unit.pluralName ?? item.unit.name;
  const archived = !!item.archivedAt;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-3">
        <div id="photo-slot" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{item.name}</h1>
          <p className={item.low ? 'font-semibold text-red-700' : 'text-slate-600'}>{formatQty(item.currentCount, item.unit)} · keep at least {formatQty(item.minStock, item.unit)}</p>
          {archived && <p className="text-sm font-medium text-amber-700">Archived</p>}
          {item.description && <p className="mt-1 text-sm text-slate-500">{item.description}</p>}
        </div>
        {!archived && <Link className="btn-ghost" to="edit">Edit</Link>}
      </div>

      {!archived && (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={() => setAdjustOpen(true)}>Correct count</button>
          <button className={item.nextTripRowId ? 'btn-primary' : 'btn-ghost'} aria-pressed={!!item.nextTripRowId}
            onClick={() => run(() => item.nextTripRowId ? removeRow({ hid, id: item.nextTripRowId }).unwrap() : addToList({ hid, body: { itemId: item.id } }).unwrap())}>
            {item.nextTripRowId ? 'On next trip ✓' : 'Add to next trip'}
          </button>
        </div>
      )}

      {item.autoDeductQty !== null && (
        <p className="card text-sm">Uses {formatQty(item.autoDeductQty, item.unit)} every {item.autoDeductPeriodDays} day(s){item.autoDeductPaused && ' — paused'}</p>
      )}

      {!archived && (
        <section className="card space-y-2">
          <div className="flex items-center justify-between"><h2 className="font-medium">Usage</h2>
            <select aria-label="Rate window" className="input w-auto" value={effectiveWindow} onChange={(e) => setWindow(e.target.value as RateWindow)}>
              {RATE_WINDOWS.map((w) => <option key={w} value={w}>{w === '183d' ? '6 months' : w === '365d' ? '1 year' : `${w.slice(0, -1)} days`}</option>)}
            </select></div>
          <p className="text-slate-700">{rate ? `${Math.round(rate.avgPerDay * 7 * 100) / 100} ${unitLabel} / week` : '…'}
            {rate && rate.avgPerDay > 0 && item.currentCount > 0 && <span className="text-slate-500"> · about {Math.round(item.currentCount / rate.avgPerDay)} days left</span>}</p>
        </section>
      )}

      <section className="card space-y-2">
        <h2 className="font-medium">History</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {events?.events.map((e) => (
            <li key={e.id} className="flex justify-between gap-2 py-2">
              <span>{EVENT_LABEL[e.eventType]} {e.eventType === 'adjust' && e.quantity > 0 ? '+' : ''}{formatQty(e.quantity, item.unit)}{e.note ? ` · ${e.note}` : ''}</span>
              <span className="whitespace-nowrap text-slate-500">{e.userName ?? 'auto'} · {new Date(e.createdAt).toLocaleDateString()}</span>
            </li>
          ))}
          {events?.events.length === 0 && <li className="py-2 text-slate-500">No history yet.</li>}
        </ul>
        {events?.nextCursor && <button className="btn-ghost w-full" onClick={() => setCursor(events.nextCursor!)}>Older</button>}
      </section>

      {!archived && (
        <section className="card space-y-2">
          <h2 className="font-medium">Merge a duplicate into this item</h2>
          <p className="text-sm text-slate-500">The other item's history and count move here; it gets archived (recoverable).</p>
          <select aria-label="Duplicate item" className="input" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
            <option value="">Choose the duplicate…</option>
            {others?.filter((o) => o.id !== item.id).map((o) => <option key={o.id} value={o.id}>{o.name} ({formatQty(o.currentCount, o.unit)})</option>)}
          </select>
          {mergeTarget && (<>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={keepMin === 'source'} onChange={(e) => setKeepMin(e.target.checked ? 'source' : 'target')} />Use the duplicate's minimum instead</label>
            <button className="btn-primary w-full" onClick={() => run(() => consolidate({ hid, targetId: item.id, sourceId: mergeTarget, keepMinStockFrom: keepMin }).unwrap(), () => { setMergeTarget(''); toast.show({ message: 'Merged' }); })}>Merge into {item.name}</button>
          </>)}
        </section>
      )}

      <section className="space-y-2">
        {!archived && <button className="btn-ghost w-full" onClick={() => run(() => archive({ hid, id }).unwrap(), () => navigate(`/h/${hid}`))}>Archive</button>}
        {archived && <button className="btn-ghost w-full" onClick={() => run(() => unarchive({ hid, id }).unwrap())}>Restore from archive</button>}
        {archived && me?.user.isAdmin && (
          <button className="btn-danger w-full" onClick={() => { if (confirm(`Permanently delete "${item.name}" and all its history? This cannot be undone.`)) void run(() => del({ hid, id }).unwrap(), () => navigate(`/h/${hid}/settings`)); }}>Delete permanently</button>
        )}
      </section>

      <QtyDialog open={adjustOpen} title={`How many ${item.name} are there really?`} initial={item.currentCount} unitLabel={unitLabel} allowNegative
        onConfirm={(n) => run(() => adjust({ hid, itemId: id, newCount: n }).unwrap())} onClose={() => setAdjustOpen(false)} />
    </div>
  );
}
```

In `App.tsx` replace the three item placeholders: `items/new` → `<ItemForm />`, `items/:id` → `<ItemDetail />`, `items/:id/edit` → `<ItemForm />`.

- [ ] **Step 3: Verify + commit**

`pnpm --filter @plantry/frontend typecheck && pnpm --filter @plantry/frontend test`
Manual: create "Water filter" (uses 1 every 90 days) → detail shows the auto-deduct line and the rate window defaults to "6 months"; "Correct count" writes an Adjusted history row; create two bean items and merge one into the other → count sums, source appears under archived (Task 23 list), history shows both; archive → back on list it's gone.

```bash
git add -A && git commit -m "feat(frontend): item form with period-based auto-deduct, item detail with rate, history, merge, archive"
```

---

### Task 22: Shopping list screen

**Files:**
- Create: `src/pages/Shopping.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useGetShoppingListQuery`, `usePurchaseMutation`, `useUndoEventMutation`, `useAddToListMutation`, `useCheckListRowMutation`, `useRemoveListRowMutation`, `useGetStoresQuery`, `useLongPress`, `QtyDialog`, `useToast`, `formatQty`.

- [ ] **Step 1: Implement**

`src/pages/Shopping.tsx`:
```tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ShoppingEntry } from '@plantry/shared';
import {
  useAddToListMutation, useCheckListRowMutation, useGetShoppingListQuery, useGetStoresQuery, usePurchaseMutation, useRemoveListRowMutation, useUndoEventMutation,
} from '../api';
import { QtyDialog } from '../components/QtyDialog';
import { useToast } from '../components/Toast';
import { errorMessage, formatQty } from '../lib/format';
import { useLongPress } from '../lib/useLongPress';

type ItemEntry = Extract<ShoppingEntry, { kind: 'item' }>;
type TextEntry = Extract<ShoppingEntry, { kind: 'text' }>;

function ItemEntryRow({ hid, entry }: { hid: string; entry: ItemEntry }) {
  const [purchase, { isLoading }] = usePurchaseMutation();
  const [undo] = useUndoEventMutation();
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const buy = async (quantity?: number) => {
    try {
      const r = await purchase({ hid, itemId: entry.itemId, ...(quantity !== undefined ? { quantity } : {}) }).unwrap();
      toast.show({ message: `Got ${formatQty(quantity ?? entry.quantity, entry.unit)} · ${entry.name}`, actionLabel: 'Undo', onAction: () => undo({ hid, eventId: r.eventId }), durationMs: 6000 });
    } catch (err) { toast.show({ message: errorMessage(err) }); }
  };
  const press = useLongPress(() => setOpen(true), () => void buy());
  return (
    <li>
      <button type="button" disabled={isLoading} className="flex min-h-14 w-full items-center gap-3 border-b border-slate-100 bg-white px-3 py-2 text-left active:bg-green-50" {...press}
        aria-label={`Got ${entry.name}, ${formatQty(entry.quantity, entry.unit)}`}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-slate-300" />
        {entry.thumbUrl && <img src={entry.thumbUrl} alt="" className="h-10 w-10 rounded-lg object-cover" loading="lazy" />}
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{entry.name}</span>
          <span className="text-sm text-slate-500">buy {formatQty(entry.quantity, entry.unit)} · have {formatQty(entry.currentCount, entry.unit)}</span></span>
        {entry.low && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">low</span>}
        {entry.manual && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">added</span>}
      </button>
      <QtyDialog open={open} title={`How many ${entry.name}?`} initial={entry.quantity} unitLabel={entry.unit.abbreviation ?? entry.unit.pluralName ?? entry.unit.name}
        onConfirm={(n) => void buy(n)} onClose={() => setOpen(false)} />
    </li>
  );
}

function TextEntryRow({ hid, entry }: { hid: string; entry: TextEntry }) {
  const [check] = useCheckListRowMutation();
  const [remove] = useRemoveListRowMutation();
  return (
    <li className="flex min-h-14 items-center gap-3 border-b border-slate-100 bg-white px-3 py-2">
      <input type="checkbox" className="h-7 w-7 shrink-0" checked={entry.checkedOff} aria-label={entry.name} onChange={(e) => check({ hid, id: entry.rowId, checkedOff: e.target.checked })} />
      <span className={`flex-1 ${entry.checkedOff ? 'text-slate-400 line-through' : ''}`}>{entry.name}{entry.quantity ? ` × ${entry.quantity}` : ''}</span>
      <button type="button" aria-label={`Remove ${entry.name}`} className="min-h-11 min-w-11 text-slate-400" onClick={() => remove({ hid, id: entry.rowId })}>✕</button>
    </li>
  );
}

export function Shopping() {
  const { hid = '' } = useParams();
  const { data, isLoading } = useGetShoppingListQuery(hid, { refetchOnMountOrArgChange: true });
  const { data: stores } = useGetStoresQuery(hid);
  const [addToList] = useAddToListMutation();
  const [name, setName] = useState(''); const [storeId, setStoreId] = useState('');
  const toast = useToast();

  return (
    <div>
      <form className="flex gap-2 p-3" onSubmit={async (e) => {
        e.preventDefault();
        try { await addToList({ hid, body: { name, ...(storeId ? { storeId } : {}) } }).unwrap(); setName(''); } catch (err) { toast.show({ message: errorMessage(err) }); }
      }}>
        <input className="input flex-1" placeholder="Add anything… (birthday candles)" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} aria-label="Add to list" />
        <select className="input w-28" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Store"><option value="">Any</option>{stores?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button className="btn-primary">Add</button>
      </form>
      {isLoading && <p className="p-4 text-slate-500">Loading…</p>}
      {data?.groups.length === 0 && <p className="p-8 text-center text-slate-500">All stocked up. 🎉</p>}
      {data?.groups.map((g) => (
        <section key={g.store?.id ?? 'any'}>
          <h2 className="sticky top-[57px] z-10 bg-slate-100 px-3 py-1 text-sm font-semibold uppercase tracking-wide text-slate-600">{g.store?.name ?? 'Any store'}</h2>
          <ul>{g.entries.map((e) => e.kind === 'item' ? <ItemEntryRow key={e.itemId} hid={hid} entry={e} /> : <TextEntryRow key={e.rowId} hid={hid} entry={e} />)}</ul>
        </section>
      ))}
      <p className="p-4 text-center text-xs text-slate-400">Tap when it's in the cart — it restocks the usual amount. Hold to change the amount.</p>
    </div>
  );
}
```

In `App.tsx` swap the Shopping placeholder for `<Shopping />`.

- [ ] **Step 2: Verify + commit**

`pnpm --filter @plantry/frontend typecheck`
Manual: a low item appears under its store; tap → disappears, toast Undo brings it back and the count reverts; hold → dialog → custom amount; an item still ≤ min after buying stays listed; free-text add/check/remove works; the Shopping tab badge follows the low count.

```bash
git add -A && git commit -m "feat(frontend): per-store shopping list with tap-to-restock and undo"
```

---

### Task 23: Settings, service-worker push, feedback

**Files:**
- Create: `src/lib/push.ts`, `src/pages/Settings.tsx`
- Modify: `src/sw.ts`, `src/App.tsx`

**Interfaces:**
- Consumes: all member/store/unit/archived/push/feedback hooks from `api.ts`.
- Produces: `pushSupported(): boolean`, `needsIosInstall(): boolean`, `currentSubscription(): Promise<PushSubscription | null>`, `subscribePush(vapidPublicKey: string): Promise<PushSubscriptionJSON>`, `unsubscribePush(): Promise<string | null>`.

- [ ] **Step 1: Service worker push handlers**

Append to `src/sw.ts`:
```ts
interface PushPayload { title: string; body: string; url: string }

self.addEventListener('push', (event) => {
  const p: PushPayload = event.data ? event.data.json() : { title: 'Plantry', body: '', url: '/' };
  event.waitUntil(self.registration.showNotification(p.title, { body: p.body, icon: '/favicon.svg', badge: '/favicon.svg', tag: p.url, data: { url: p.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url: string = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = wins[0];
    if (existing) { await existing.focus(); await existing.navigate(url).catch(() => undefined); return; }
    await self.clients.openWindow(url);
  })());
});
```

- [ ] **Step 2: `lib/push.ts`**

```ts
export const pushSupported = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iOS only delivers Web Push to PWAs installed to the home screen. */
export function needsIosInstall(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function subscribePush(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) }));
  return sub.toJSON();
}

export async function unsubscribePush(): Promise<string | null> {
  const sub = await currentSubscription();
  if (!sub) return null;
  await sub.unsubscribe();
  return sub.endpoint;
}
```

- [ ] **Step 3: `Settings.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  useCreateInviteMutation, useCreateStoreMutation, useCreateUnitMutation, useDeleteStoreMutation, useDeleteUnitMutation, useGetArchivedItemsQuery,
  useGetMeQuery, useGetMembersQuery, useGetMyFeedbackQuery, useGetStoresQuery, useGetUnitsQuery, useGetVapidKeyQuery, useLeaveHouseholdMutation,
  useLogoutMutation, usePushSubscribeMutation, usePushUnsubscribeMutation, useRemoveMemberMutation, useRenameHouseholdMutation,
  useSendFeedbackMutation, useSetMemberRoleMutation, useUnarchiveItemMutation,
} from '../api';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/format';
import { currentSubscription, needsIosInstall, pushSupported, subscribePush, unsubscribePush } from '../lib/push';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="card space-y-3"><h2 className="font-semibold">{title}</h2>{children}</section>
);

export function Settings() {
  const { hid = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { data: me } = useGetMeQuery();
  const household = me?.households.find((h) => h.id === hid);
  const isOwner = household?.role === 'owner';
  const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast.show({ message: ok }); } catch (err) { toast.show({ message: errorMessage(err) }); } };

  // --- household + members
  const { data: members } = useGetMembersQuery(hid);
  const [rename] = useRenameHouseholdMutation(); const [setRole] = useSetMemberRoleMutation(); const [removeMember] = useRemoveMemberMutation();
  const [leave] = useLeaveHouseholdMutation(); const [createInvite] = useCreateInviteMutation();
  const [name, setName] = useState(''); useEffect(() => setName(household?.name ?? ''), [household?.name]);
  const [inviteUrl, setInviteUrl] = useState('');

  // --- stores, units, archived
  const { data: stores } = useGetStoresQuery(hid); const [createStore] = useCreateStoreMutation(); const [deleteStore] = useDeleteStoreMutation();
  const { data: units } = useGetUnitsQuery(hid); const [createUnit] = useCreateUnitMutation(); const [deleteUnit] = useDeleteUnitMutation();
  const { data: archived } = useGetArchivedItemsQuery(hid); const [unarchive] = useUnarchiveItemMutation();
  const [storeName, setStoreName] = useState(''); const [unitName, setUnitName] = useState(''); const [unitPlural, setUnitPlural] = useState('');

  // --- notifications
  const { data: vapid } = useGetVapidKeyQuery(undefined, { skip: !me?.pushEnabled });
  const [pushSub] = usePushSubscribeMutation(); const [pushUnsub] = usePushUnsubscribeMutation();
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => { void currentSubscription().then((s) => setSubscribed(!!s)); }, []);

  // --- feedback
  const { data: feedback } = useGetMyFeedbackQuery(undefined, { skip: !me?.feedbackEnabled });
  const [sendFeedback, feedbackState] = useSendFeedbackMutation();
  const [feedbackText, setFeedbackText] = useState('');
  const [logout] = useLogoutMutation();

  return (
    <div className="space-y-4 p-4">
      <Section title="Household">
        {isOwner ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => rename({ hid, name }).unwrap(), 'Renamed'); }}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} aria-label="Household name" /><button className="btn-ghost">Rename</button>
          </form>
        ) : <p>{household?.name}</p>}
        <ul className="divide-y divide-slate-100">
          {members?.map((m) => (
            <li key={m.sub} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{m.name}{m.sub === me?.user.sub && ' (you)'}</span><span className="text-sm text-slate-500">{m.role}</span></span>
              {isOwner && m.sub !== me?.user.sub && (<>
                <button className="btn-ghost" onClick={() => run(() => setRole({ hid, sub: m.sub, role: m.role === 'owner' ? 'member' : 'owner' }).unwrap())}>{m.role === 'owner' ? 'Make member' : 'Make owner'}</button>
                <button className="btn-ghost text-red-700" onClick={() => { if (confirm(`Remove ${m.name}?`)) void run(() => removeMember({ hid, sub: m.sub }).unwrap()); }}>Remove</button>
              </>)}
            </li>
          ))}
        </ul>
        <button className="btn-primary w-full" onClick={() => run(async () => {
          const inv = await createInvite(hid).unwrap(); setInviteUrl(inv.url);
          if (navigator.share) await navigator.share({ title: `Join ${household?.name} on Plantry`, url: inv.url }).catch(() => undefined);
          else await navigator.clipboard.writeText(inv.url);
        }, 'Invite link ready (valid 7 days, single use)')}>Invite someone</button>
        {inviteUrl && <input className="input text-sm" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} aria-label="Invite link" />}
        <button className="btn-ghost w-full text-red-700" onClick={() => { if (confirm('Leave this household?')) void run(async () => { await leave(hid).unwrap(); navigate('/'); }); }}>Leave household</button>
      </Section>

      <Section title="Stores">
        <ul className="divide-y divide-slate-100">{stores?.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-1"><span>{s.name}</span>
            <button aria-label={`Delete ${s.name}`} className="min-h-11 min-w-11 text-slate-400" onClick={() => { if (confirm(`Delete ${s.name}? Items keep working and move to "Any store".`)) void run(() => deleteStore({ hid, id: s.id }).unwrap()); }}>✕</button></li>))}</ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await createStore({ hid, name: storeName }).unwrap(); setStoreName(''); }); }}>
          <input className="input" placeholder="New store" value={storeName} onChange={(e) => setStoreName(e.target.value)} required maxLength={120} /><button className="btn-ghost">Add</button></form>
      </Section>

      <Section title="Custom units">
        <ul className="divide-y divide-slate-100">{units?.filter((u) => !u.global).map((u) => (
          <li key={u.id} className="flex items-center justify-between py-1"><span>{u.name}{u.pluralName ? ` / ${u.pluralName}` : ''}</span>
            <button aria-label={`Delete ${u.name}`} className="min-h-11 min-w-11 text-slate-400" onClick={() => run(() => deleteUnit({ hid, id: u.id }).unwrap())}>✕</button></li>))}</ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await createUnit({ hid, name: unitName, pluralName: unitPlural || null }).unwrap(); setUnitName(''); setUnitPlural(''); }); }}>
          <input className="input" placeholder="sleeve" value={unitName} onChange={(e) => setUnitName(e.target.value)} required maxLength={40} aria-label="Unit name" />
          <input className="input" placeholder="sleeves" value={unitPlural} onChange={(e) => setUnitPlural(e.target.value)} maxLength={40} aria-label="Plural" /><button className="btn-ghost">Add</button></form>
        <p className="text-sm text-slate-500">Built-in units (each, oz, lb, can…) are always available.</p>
      </Section>

      <Section title="Archived items">
        {archived?.length === 0 && <p className="text-sm text-slate-500">Nothing archived.</p>}
        <ul className="divide-y divide-slate-100">{archived?.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 py-1"><Link className="min-w-0 flex-1 truncate underline" to={`/h/${hid}/items/${i.id}`}>{i.name}</Link>
            <button className="btn-ghost" onClick={() => run(() => unarchive({ hid, id: i.id }).unwrap(), 'Restored')}>Restore</button></li>))}</ul>
      </Section>

      <Section title="Low-stock notifications">
        {!me?.pushEnabled ? <p className="text-sm text-slate-500">Not configured on this server.</p>
          : !pushSupported() || needsIosInstall() ? (
            <p className="text-sm text-slate-600">{needsIosInstall()
              ? 'On iPhone/iPad, first add Plantry to your Home Screen (Share → Add to Home Screen), then open it from there to turn on notifications.'
              : 'This browser does not support push notifications.'}</p>)
          : (<button className={subscribed ? 'btn-ghost w-full' : 'btn-primary w-full'} onClick={() => run(async () => {
              if (subscribed) { const endpoint = await unsubscribePush(); if (endpoint) await pushUnsub({ endpoint }).unwrap(); setSubscribed(false); return; }
              const json = await subscribePush(vapid!.publicKey!);
              await pushSub({ endpoint: json.endpoint!, keys: { p256dh: json.keys!['p256dh']!, auth: json.keys!['auth']! } }).unwrap();
              setSubscribed(true);
            }, subscribed ? 'Notifications off on this device' : 'Notifications on for this device')}>{subscribed ? 'Turn off on this device' : 'Turn on for this device'}</button>)}
        <p className="text-sm text-slate-500">One summary each morning, per household, when something is running low.</p>
      </Section>

      {me?.feedbackEnabled && (
        <Section title="Feedback">
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await sendFeedback({ body: feedbackText, pageUrl: location.pathname }).unwrap(); setFeedbackText(''); }, 'Thanks — sent!'); }}>
            <textarea className="input min-h-24 py-2" placeholder="Something broken, confusing, or missing?" value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} required maxLength={4000} aria-label="Feedback" />
            <button className="btn-primary w-full" disabled={feedbackState.isLoading}>Send feedback</button>
          </form>
          {!!feedback?.length && <ul className="divide-y divide-slate-100 text-sm">{feedback.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 flex-1 truncate">{f.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${f.status === 'done' ? 'bg-green-100 text-green-800' : f.status === 'closed' ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-800'}`}>{f.status}</span></li>))}</ul>}
        </Section>
      )}

      <button className="btn-ghost w-full" onClick={() => run(async () => { const r = await logout().unwrap(); window.location.assign(r.endSessionUrl ?? '/'); })}>Sign out ({me?.user.name})</button>
    </div>
  );
}
```

In `App.tsx` swap the Settings placeholder for `<Settings />` and delete the now-unused `Placeholder` component.

- [ ] **Step 4: Verify + commit**

`pnpm --filter @plantry/frontend typecheck && pnpm --filter @plantry/frontend build`
Manual: invite → open link in a second profile → lands in the household; owner toggles roles; last-owner leave shows "Assign another owner first"; store delete moves items to "Any store"; unit-in-use delete shows the count message. Push requires a production build over a secure context: generate dev VAPID keys with `pnpm --filter @plantry/backend exec web-push generate-vapid-keys`, put them in `.env`, run `pnpm --filter @plantry/frontend build && pnpm --filter @plantry/frontend preview --port 5173`, subscribe, then trigger a digest: make an item low, `DELETE FROM job_runs;`, restart the backend (boot catch-up runs the daily job) → notification appears; clicking it opens the shopping list.

```bash
git add -A && git commit -m "feat(frontend): settings (members, invites, stores, units, archive), web push, GitHub feedback"
```

---

### Task 24: Photos + barcode scanner

**Files:**
- Create: `src/lib/downscale.ts`, `src/components/PhotoPicker.tsx`, `src/components/Scanner.tsx`
- Modify: `src/pages/ItemDetail.tsx`, `src/pages/Inventory.tsx`
- Test: `src/lib/downscale.test.ts`

**Interfaces:**
- Consumes: `usePhotoUploadUrlMutation`, `usePhotoFinalizeMutation`, `usePhotoDeleteMutation`, `useLazyFindByBarcodeQuery`, `useRestockMutation`, `useConsumeMutation`, shared `PHOTO_MAX_EDGE`, `THUMB_MAX_EDGE`.
- Produces: `fitWithin(w, h, maxEdge): { width: number; height: number }`, `downscale(file: Blob, maxEdge: number, quality?: number): Promise<Blob>`; `<PhotoPicker hid item />`; `<Scanner open onDetected(code) onClose />`.

- [ ] **Step 1: Failing test**

`src/lib/downscale.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { fitWithin } from './downscale';

describe('fitWithin', () => {
  it('scales the long edge down, keeps aspect ratio, never upscales', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(5000, 10, 256)).toEqual({ width: 256, height: 1 });
  });
});
```

- [ ] **Step 2: Implement `downscale.ts`**

```ts
export function fitWithin(w: number, h: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Re-encodes to JPEG on a canvas: shrinks the file and strips EXIF/GPS as a side effect. */
export async function downscale(file: Blob, maxEdge: number, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); // flatten transparency
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encode failed'))), 'image/jpeg', quality));
}
```

- [ ] **Step 3: `PhotoPicker`**

```tsx
import { useRef, useState } from 'react';
import { PHOTO_MAX_EDGE, THUMB_MAX_EDGE, type ItemDto } from '@plantry/shared';
import { useGetMeQuery, usePhotoDeleteMutation, usePhotoFinalizeMutation, usePhotoUploadUrlMutation } from '../api';
import { errorMessage } from '../lib/format';
import { downscale } from '../lib/downscale';
import { useToast } from './Toast';

async function putJpeg(url: string, blob: Blob): Promise<void> {
  // Direct-to-MinIO presigned PUT: the one place the UI calls fetch itself. Content-Type must match what was signed.
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

export function PhotoPicker({ hid, item }: { hid: string; item: ItemDto }) {
  const { data: me } = useGetMeQuery();
  const [uploadUrl] = usePhotoUploadUrlMutation(); const [finalize] = usePhotoFinalizeMutation(); const [remove] = usePhotoDeleteMutation();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  if (!me?.photosEnabled) return null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const [full, thumb] = await Promise.all([downscale(file, PHOTO_MAX_EDGE), downscale(file, THUMB_MAX_EDGE, 0.75)]);
      const up = await uploadUrl({ hid, id: item.id, sizeBytes: full.size, thumbSizeBytes: thumb.size }).unwrap();
      await Promise.all([putJpeg(up.uploadUrl, full), putJpeg(up.thumbUploadUrl, thumb)]);
      await finalize({ hid, id: item.id, key: up.key }).unwrap();
    } catch (err) { toast.show({ message: err instanceof Error && !('data' in err) ? err.message : errorMessage(err) }); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button type="button" disabled={busy} onClick={() => input.current?.click()} aria-label={item.imageUrl ? 'Change photo' : 'Add photo'}
        className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-100 text-sm text-slate-500">
        {busy ? '…' : item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" /> : '+ Photo'}
      </button>
      {item.imageUrl && !busy && <button type="button" className="text-xs text-slate-500 underline" onClick={() => remove({ hid, id: item.id })}>Remove</button>}
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
  );
}
```
In `ItemDetail.tsx` replace `<div id="photo-slot" className="shrink-0" />` with `{!archived && <PhotoPicker hid={hid} item={item} />}` (import it).

- [ ] **Step 4: `Scanner` + inventory integration**

`src/components/Scanner.tsx`:
```tsx
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (opts?: { formats?: string[] }) => Detector } }
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export function Scanner({ open, onDetected, onClose }: { open: boolean; onDetected(code: string): void; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let stopped = false; let stream: MediaStream | undefined; let raf = 0; let zxingStop: (() => void) | undefined;
    const done = (code: string) => { if (!stopped) { stopped = true; onDetected(code); } };

    (async () => {
      try {
        if (window.BarcodeDetector) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (stopped || !video.current) return;
          video.current.srcObject = stream; await video.current.play();
          const detector = new window.BarcodeDetector({ formats: FORMATS });
          const tick = async () => {
            if (stopped || !video.current) return;
            try { const hit = (await detector.detect(video.current))[0]; if (hit) return done(hit.rawValue); } catch { /* frame not ready */ }
            raf = requestAnimationFrame(() => void tick());
          };
          void tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser'); // lazy: keeps zxing out of the main bundle
          const controls = await new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video.current!, (result) => { if (result) done(result.getText()); });
          zxingStop = () => controls.stop();
          if (stopped) zxingStop();
        }
      } catch { setError('Camera unavailable — check the site permission, or type the barcode on the item form.'); }
    })();

    return () => { stopped = true; cancelAnimationFrame(raf); zxingStop?.(); stream?.getTracks().forEach((t) => t.stop()); };
  }, [open, onDetected]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content className="fixed inset-x-4 top-[10%] z-50 mx-auto max-w-sm space-y-3 rounded-2xl bg-white p-4">
          <Dialog.Title className="font-semibold">Scan a barcode</Dialog.Title>
          {error ? <p className="text-sm text-red-700">{error}</p> : <video ref={video} className="aspect-[4/3] w-full rounded-lg bg-black object-cover" muted playsInline />}
          <button type="button" className="btn-ghost w-full" onClick={onClose}>Cancel</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

In `src/pages/Inventory.tsx`:
- imports: `useCallback`, `useNavigate`, `* as Dialog from '@radix-ui/react-dialog'`, `Scanner`, `useLazyFindByBarcodeQuery`, `useRestockMutation`, `useConsumeMutation`, `useToast`, `errorMessage`, `formatQty`, type `ItemDto`.
- state + handler inside the component:
```tsx
  const navigate = useNavigate();
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [match, setMatch] = useState<ItemDto | null>(null);
  const [findByBarcode] = useLazyFindByBarcodeQuery();
  const [restock] = useRestockMutation(); const [consume] = useConsumeMutation();
  const onDetected = useCallback(async (code: string) => {
    setScanning(false);
    try {
      const hits = await findByBarcode({ hid, barcode: code }).unwrap();
      if (hits[0]) setMatch(hits[0]); else navigate(`/h/${hid}/items/new?barcode=${encodeURIComponent(code)}`);
    } catch (err) { toast.show({ message: errorMessage(err) }); }
  }, [findByBarcode, hid, navigate, toast]);
  const quick = async (kind: 'restock' | 'consume') => {
    if (!match) return;
    const quantity = kind === 'restock' ? match.defaultRestockQty : 1;
    try { await (kind === 'restock' ? restock : consume)({ hid, itemId: match.id, quantity }).unwrap(); toast.show({ message: `${kind === 'restock' ? 'Added' : 'Used'} ${formatQty(quantity, match.unit)} · ${match.name}` }); }
    catch (err) { toast.show({ message: errorMessage(err) }); }
    setMatch(null);
  };
```
- in the toolbar, before the "+ New" link: `<button type="button" className="btn-ghost whitespace-nowrap" onClick={() => setScanning(true)}>Scan</button>`
- at the end of the returned JSX:
```tsx
      <Scanner open={scanning} onDetected={onDetected} onClose={() => setScanning(false)} />
      <Dialog.Root open={!!match} onOpenChange={(o) => !o && setMatch(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl space-y-2 rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Dialog.Title className="text-lg font-semibold">{match?.name}</Dialog.Title>
            <Dialog.Description className="text-slate-500">{match && `Have ${formatQty(match.currentCount, match.unit)}`}</Dialog.Description>
            <button className="btn-primary w-full" onClick={() => void quick('restock')}>Restock {match && formatQty(match.defaultRestockQty, match.unit)}</button>
            <button className="btn-ghost w-full" onClick={() => void quick('consume')}>Use 1</button>
            <button className="btn-ghost w-full" onClick={() => { if (match) navigate(`/h/${hid}/items/${match.id}`); }}>Open item</button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
```

- [ ] **Step 5: Verify + commit**

```bash
pnpm --filter @plantry/frontend test && pnpm --filter @plantry/frontend typecheck && pnpm --filter @plantry/frontend build
```
Manual (with `docker compose up -d minio minio-setup` and `S3_*` in `.env`): add a photo from a phone-sized image → thumbnail appears in the inventory list and shopping list; check in the MinIO console (`localhost:9101`) that two small JPEGs exist under `h/<hid>/items/<id>/`; replace → old pair gone. Scanner: on desktop Chrome with a webcam scan any product; unknown code opens the new-item form with the barcode filled; known code opens the action sheet. (Camera needs a secure context — `localhost` qualifies.)

```bash
git add -A && git commit -m "feat(frontend): item photos with client-side downscale, barcode scanning"
```

---

### Task 25: Playwright smoke

**Files:**
- Create: `apps/frontend/playwright.config.ts`, `apps/frontend/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: dev bypass login, the full UI.

- [ ] **Step 1: Config + spec**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:5173', ...devices['Pixel 7'] },
  webServer: [
    { command: 'pnpm --filter @plantry/backend dev', url: 'http://localhost:3000/health', reuseExistingServer: true, cwd: '../..' },
    { command: 'pnpm --filter @plantry/frontend dev', url: 'http://localhost:5173', reuseExistingServer: true, cwd: '../..' },
  ],
});
```
(Requires `docker compose up -d postgres`, a migrated dev DB, and `AUTH_DEV_BYPASS=1` in `.env`.)

`e2e/smoke.spec.ts`:
```ts
import { expect, test } from '@playwright/test';

test('create household → item → consume to low → buy from shopping list → undo', async ({ page }) => {
  const stamp = Date.now();
  await page.goto(`/api/auth/dev-login?sub=e2e-${stamp}&name=E2E`);
  await expect(page.getByText('Hi E2E')).toBeVisible();

  await page.getByLabel('Create a household').fill(`E2E ${stamp}`);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('link', { name: '+ New' })).toBeVisible();

  await page.getByRole('link', { name: '+ New' }).click();
  await page.getByLabel('Name').fill('Cat food');
  await page.getByLabel('Have now').fill('3');
  await page.getByLabel('Minimum to keep').fill('2');
  await page.getByLabel('Usually buy').fill('12');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Cat food' })).toBeVisible();

  await page.getByRole('link', { name: 'Inventory' }).click();
  await page.getByRole('button', { name: 'Use 1 Cat food' }).click();
  await expect(page.getByText('2 ea · low')).toBeVisible(); // global "each" has abbreviation "ea"

  await page.getByRole('link', { name: /Shopping/ }).click();
  await page.getByRole('button', { name: /Got Cat food/ }).click();
  await expect(page.getByText('All stocked up.')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('button', { name: /Got Cat food/ })).toBeVisible();
});
```
- [ ] **Step 2: Run**

```bash
pnpm --filter @plantry/frontend exec playwright install chromium
pnpm --filter @plantry/frontend e2e
```
Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test(e2e): playwright smoke of the core stock → shopping loop"
```
