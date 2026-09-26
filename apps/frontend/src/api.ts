import { createApi, fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import type {
  EventsPageDto, FeedbackDto, GroupDto, HouseholdSummary, InviteDto, ItemCreateInput, ItemDto, ItemUpdateInput, MeDto, MemberDto, MemberRole,
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
const STOCK_TAGS = ['Items', 'Shopping', 'Events', 'Rates', 'Groups'] as const;
interface StockResult { item: ItemDto; eventId: string | null }

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  // Presigned photo URLs live for an hour. Refetching when the tab regains focus (or the
  // network comes back) is what actually replaces the expired ones — `setupListeners` in
  // store.ts only dispatches the events; without these flags nothing opts in. Every form in
  // the app hydrates local state from a query exactly once per id, so a refetch cannot
  // clobber what the user is typing.
  refetchOnFocus: true,
  refetchOnReconnect: true,
  tagTypes: ['Me', 'Members', 'Stores', 'Units', 'Items', 'Shopping', 'Events', 'Rates', 'Feedback', 'Groups'],
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

    getGroups: b.query<GroupDto[], string>({ query: (hid) => `${h(hid)}/groups`, providesTags: ['Groups'] }),
    createGroup: b.mutation<GroupDto, Hid & { name: string; minStock?: number; preferredStoreId?: string | null; renotifyAfterDays?: number }>({ query: ({ hid, ...body }) => ({ url: `${h(hid)}/groups`, method: 'POST', body }), invalidatesTags: ['Groups'] }),
    updateGroup: b.mutation<GroupDto, Hid & { id: string; name?: string; minStock?: number; preferredStoreId?: string | null; renotifyAfterDays?: number }>({ query: ({ hid, id, ...body }) => ({ url: `${h(hid)}/groups/${id}`, method: 'PATCH', body }), invalidatesTags: ['Groups', 'Items', 'Shopping'] }),
    deleteGroup: b.mutation<void, Hid & { id: string }>({ query: ({ hid, id }) => ({ url: `${h(hid)}/groups/${id}`, method: 'DELETE' }), invalidatesTags: ['Groups', 'Items', 'Shopping'] }),

    getUnits: b.query<UnitDto[], string>({ query: (hid) => `${h(hid)}/units`, providesTags: ['Units'] }),
    createUnit: b.mutation<UnitDto, Hid & { name: string; pluralName?: string | null; abbreviation?: string | null; step?: number }>({ query: ({ hid, ...body }) => ({ url: `${h(hid)}/units`, method: 'POST', body }), invalidatesTags: ['Units'] }),
    updateUnit: b.mutation<UnitDto, Hid & { id: string; name?: string; pluralName?: string | null; abbreviation?: string | null; step?: number }>({ query: ({ hid, id, ...body }) => ({ url: `${h(hid)}/units/${id}`, method: 'PATCH', body }), invalidatesTags: ['Units', 'Items', 'Shopping'] }),
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

/**
 * Optimistically bumps the count in the cached inventory list; rolls back if the request fails.
 *
 * Rollback applies the INVERSE DELTA rather than `patch.undo()`. `undo()` restores the snapshot
 * that was taken before this particular patch, so with two rapid taps in flight the first
 * failure would wipe out the second tap's optimistic change and the second failure would then
 * restore it — leaving the wrong count. Deltas compose in any order.
 */
async function optimisticCount(
  hid: string, itemId: string, delta: number,
  { dispatch, queryFulfilled }: { dispatch: (a: any) => any; queryFulfilled: Promise<unknown> },
): Promise<void> {
  const apply = (d: number) => dispatch(api.util.updateQueryData('getInventory', hid, (draft) => {
    const item = draft.find((i) => i.id === itemId);
    if (!item) return;
    item.currentCount = Math.round((item.currentCount + d) * 1000) / 1000;
    item.low = item.currentCount <= item.minStock;
    // Mirrors serializeItem: a grouped item never nags on its own — the group nags for it.
    item.nagging = item.low && item.trackLow && !item.groupId;
  }));
  apply(delta);
  try { await queryFulfilled; } catch { apply(-delta); }
}

export const {
  useGetMeQuery, useLogoutMutation, useCreateHouseholdMutation, useAcceptInviteMutation, useRenameHouseholdMutation,
  useGetMembersQuery, useSetMemberRoleMutation, useRemoveMemberMutation, useLeaveHouseholdMutation, useCreateInviteMutation,
  useGetStoresQuery, useCreateStoreMutation, useUpdateStoreMutation, useDeleteStoreMutation,
  useGetGroupsQuery, useCreateGroupMutation, useUpdateGroupMutation, useDeleteGroupMutation,
  useGetUnitsQuery, useCreateUnitMutation, useUpdateUnitMutation, useDeleteUnitMutation,
  useGetInventoryQuery, useGetArchivedItemsQuery, useLazyFindByBarcodeQuery, useGetItemQuery, useCreateItemMutation, useUpdateItemMutation,
  useArchiveItemMutation, useUnarchiveItemMutation, useDeleteItemMutation, useConsolidateMutation,
  useRestockMutation, useConsumeMutation, useAdjustMutation, useUndoEventMutation, useGetEventsQuery, useGetRateQuery,
  useGetShoppingListQuery, usePurchaseMutation, useAddToListMutation, useCheckListRowMutation, useRemoveListRowMutation,
  usePhotoUploadUrlMutation, usePhotoFinalizeMutation, usePhotoDeleteMutation,
  useGetVapidKeyQuery, usePushSubscribeMutation, usePushUnsubscribeMutation, useGetMyFeedbackQuery, useSendFeedbackMutation,
} = api;
