export const RATE_WINDOWS = ['30d', '60d', '90d', '183d', '365d'] as const;
export type RateWindow = (typeof RATE_WINDOWS)[number];
export function windowDays(w: RateWindow): number {
  return Number(w.slice(0, -1));
}

export const EVENT_TYPES = ['restock', 'consume', 'adjust', 'auto_deduct'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const ERROR_CODES = [
  'validation_error', 'archive_first', 'unauthorized', 'forbidden', 'not_found', 'last_owner',
  'unit_in_use', 'barcode_conflict', 'already_on_list', 'undo_expired', 'invite_invalid',
  'photos_disabled', 'internal', 'rate_limited',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const UNDO_WINDOW_MS = 5 * 60 * 1000;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const THUMB_MAX_BYTES = 200 * 1024;
export const PHOTO_MAX_EDGE = 1600;
export const THUMB_MAX_EDGE = 256;
