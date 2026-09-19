import { notFound } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID_RE.test(s);

/** Validates a route param is a UUID; anything else is indistinguishable from "doesn't exist". */
export function uuidParam(v: unknown): string {
  if (!isUuid(v)) throw notFound();
  return v;
}
