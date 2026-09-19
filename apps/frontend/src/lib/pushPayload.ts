// No DOM/worker types here on purpose: this is exercised by the service worker (workerglobal
// context) AND by plain unit tests under jsdom/Node, so it must stay a pure string-in/object-out
// function.
export interface PushPayload { title: string; body: string; url: string }

const FALLBACK: PushPayload = { title: 'Plantry', body: '', url: '/' };

/** Parses a push message body defensively — a malformed or hostile payload must never throw. */
export function parsePushPayload(text: string | null): PushPayload {
  if (!text) return FALLBACK;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return FALLBACK;
  }
  if (typeof raw !== 'object' || raw === null) return FALLBACK;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === 'string' && r.title.length > 0 ? r.title : FALLBACK.title;
  const body = typeof r.body === 'string' ? r.body : FALLBACK.body;
  // Only ever navigate to a same-origin, absolute path — never an absolute URL, protocol-relative
  // ("//host/…") URL, or a "javascript:" scheme. (notificationclick double-checks this again with
  // a real URL() resolution before navigating, but the payload itself should already be sane.)
  const url = typeof r.url === 'string' && r.url.startsWith('/') && !r.url.startsWith('//') ? r.url : FALLBACK.url;
  return { title, body, url };
}
