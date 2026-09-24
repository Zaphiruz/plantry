import type { EventType, RateWindow } from './constants.js';

export type MemberRole = 'owner' | 'member';
export interface UserDto { sub: string; name: string; email: string; isAdmin: boolean }
export interface HouseholdSummary { id: string; name: string; role: MemberRole }
export interface MeDto { user: UserDto; households: HouseholdSummary[]; photosEnabled: boolean; pushEnabled: boolean; feedbackEnabled: boolean }
export interface MemberDto { sub: string; name: string; email: string; role: MemberRole; joinedAt: string }
export interface InviteDto { url: string; expiresAt: string }
export interface StoreDto { id: string; name: string; notes: string | null }
export interface UnitDto { id: string; name: string; pluralName: string | null; abbreviation: string | null; global: boolean; step: number }

export interface ItemDto {
  id: string; name: string; description: string | null; category: string | null;
  unit: UnitDto; preferredStoreId: string | null; barcodes: string[];
  renotifyAfterDays: number; defaultRestockQty: number;
  autoDeductQty: number | null; autoDeductPeriodDays: number; autoDeductPaused: boolean;
  archivedAt: string | null;
  currentCount: number; minStock: number; low: boolean;
  lastRestockedAt: string | null;
  nextTripRowId: string | null;
  imageUrl: string | null; thumbUrl: string | null; imageUrlsExpireAt: string | null;
}

export interface EventDto {
  id: string; itemId: string; eventType: EventType; quantity: number;
  note: string | null; userSub: string | null; userName: string | null; createdAt: string;
}
export interface EventsPageDto { events: EventDto[]; nextCursor: string | null }
export interface RateDto { itemId: string; window: RateWindow; avgPerDay: number; days: number }

export type ShoppingEntry =
  | { kind: 'item'; itemId: string; name: string; unit: UnitDto; quantity: number; low: boolean; manual: boolean;
      rowId: string | null; currentCount: number; minStock: number; thumbUrl: string | null }
  | { kind: 'text'; rowId: string; name: string; quantity: number | null; checkedOff: boolean };
export interface ShoppingGroup { store: { id: string; name: string } | null; entries: ShoppingEntry[] }
export interface ShoppingListDto { groups: ShoppingGroup[] }
export interface PurchaseResultDto { eventId: string }

export interface PhotoUploadDto { key: string; uploadUrl: string; thumbUploadUrl: string }
export interface ApiError { error: { code: string; message: string; details?: unknown } }

export interface FeedbackDto {
  id: string; issueNumber: number; issueUrl: string; title: string; createdAt: string;
  status: 'open' | 'done' | 'closed'; closedAt: string | null;
}
