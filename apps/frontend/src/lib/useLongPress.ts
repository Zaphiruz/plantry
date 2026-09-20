import { useEffect, useRef } from 'react';

/**
 * Tap → onClick; hold ≥ ms → onLongPress (and the tap is swallowed). Moving the pointer away
 * (or a cancelled pointer, e.g. a scroll) cancels both.
 *
 * Keyboards and screen readers dispatch a synthetic `click` with no pointer events at all, so
 * `onClick` is also handled — but only when `detail === 0`, which is how the platform marks a
 * click that did not come from a pointer. A real tap's trailing click has `detail >= 1` and is
 * ignored here, so it never double-fires.
 */
export function useLongPress(onLongPress: () => void, onClick: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const fired = useRef(false);
  const clear = () => clearTimeout(timer.current);
  useEffect(() => clear, []);
  return {
    onPointerDown: () => { fired.current = false; timer.current = setTimeout(() => { fired.current = true; onLongPress(); }, ms); },
    onPointerUp: () => { clear(); if (!fired.current) onClick(); },
    onPointerLeave: () => { clear(); fired.current = true; },
    onPointerCancel: () => { clear(); fired.current = true; },
    onClick: (e: { detail: number }) => { if (e.detail === 0) onClick(); },
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  };
}
