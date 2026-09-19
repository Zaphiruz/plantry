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
