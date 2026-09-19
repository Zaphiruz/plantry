import { useEffect, useRef } from 'react';

/** Tap → onClick; hold ≥ ms → onLongPress (and the tap is swallowed). Moving the pointer away (or a cancelled pointer, e.g. a scroll) cancels both. */
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
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  };
}
