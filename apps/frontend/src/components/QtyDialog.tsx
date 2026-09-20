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
          <Dialog.Description className="sr-only">Enter a quantity in {unitLabel} and confirm.</Dialog.Description>
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
