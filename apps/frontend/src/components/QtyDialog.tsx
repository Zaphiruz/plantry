import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';

interface Props { open: boolean; title: string; initial: number; step: number; unitLabel: string; allowNegative?: boolean; onConfirm(n: number): void; onClose(): void }

const threeDp = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function QtyDialog({ open, title, initial, step, unitLabel, allowNegative, onConfirm, onClose }: Props) {
  const [value, setValue] = useState(String(initial));
  // Hydrate only on the open transition (false -> true), not on every `initial` change while
  // open — otherwise a background refetch (e.g. refetchOnFocus) overwrites what the user typed.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) setValue(String(initial));
    wasOpen.current = open;
    // Intentionally omits `initial`: re-hydrate only on the open transition, not on every
    // `initial` change while open (e.g. a background refetch).
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(n) && threeDp(n) && (allowNegative ? true : n >= 0.01);

  const nudge = (delta: number) => {
    const current = Number(value);
    const base = Number.isFinite(current) ? current : 0;
    let next = round3(base + delta);
    if (!allowNegative) next = Math.max(next, step);
    setValue(String(next));
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed inset-x-4 top-1/4 z-50 mx-auto max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">Enter a quantity in {unitLabel} and confirm.</Dialog.Description>
          <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); if (valid) { onConfirm(n); onClose(); } }}>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Decrease" className="btn-ghost min-h-11 min-w-11 text-xl" onClick={() => nudge(-step)}>−</button>
              <label className="flex flex-1 items-center gap-2">
                <input autoFocus className="input" type="number" inputMode="decimal" step={step} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Quantity" />
                <span className="text-slate-500">{unitLabel}</span>
              </label>
              <button type="button" aria-label="Increase" className="btn-ghost min-h-11 min-w-11 text-xl" onClick={() => nudge(step)}>+</button>
            </div>
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
