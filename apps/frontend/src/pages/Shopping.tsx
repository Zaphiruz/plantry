import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import type { ShoppingEntry } from '@plantry/shared';
import {
  useAddToListMutation, useCheckListRowMutation, useGetInventoryQuery, useGetShoppingListQuery, useGetStoresQuery, usePurchaseMutation,
  useRemoveListRowMutation, useUndoEventMutation,
} from '../api';
import { QtyDialog } from '../components/QtyDialog';
import { QueryError } from '../components/QueryError';
import { useToast } from '../components/Toast';
import { errorMessage, formatQty } from '../lib/format';
import { useLongPress } from '../lib/useLongPress';

type ItemEntry = Extract<ShoppingEntry, { kind: 'item' }>;
type TextEntry = Extract<ShoppingEntry, { kind: 'text' }>;
type GroupEntry = Extract<ShoppingEntry, { kind: 'group' }>;

function ItemEntryRow({ hid, entry }: { hid: string; entry: ItemEntry }) {
  const [purchase, { isLoading }] = usePurchaseMutation();
  const [undo] = useUndoEventMutation();
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const inFlight = useRef(false);
  const buy = async (quantity?: number) => {
    if (inFlight.current) return; // synchronous guard: `isLoading` only updates after a re-render, so two
    inFlight.current = true; // pointer-ups before that render both read stale `false` and would double-purchase
    try {
      const r = await purchase({ hid, itemId: entry.itemId, ...(quantity !== undefined ? { quantity } : {}) }).unwrap();
      toast.show({
        message: `Got ${formatQty(quantity ?? entry.quantity, entry.unit)} · ${entry.name}`,
        actionLabel: 'Undo',
        onAction: () => { undo({ hid, eventId: r.eventId }).unwrap().catch((err) => toast.show({ message: errorMessage(err) })); },
        durationMs: 6000,
      });
    } catch (err) { toast.show({ message: errorMessage(err) }); } finally { inFlight.current = false; }
  };
  const press = useLongPress(() => setOpen(true), () => void buy());
  return (
    <li>
      <button type="button" disabled={isLoading} className="flex min-h-14 w-full touch-manipulation items-center gap-3 border-b border-slate-100 bg-white px-3 py-2 text-left active:bg-green-50" {...press}
        aria-label={`Got ${entry.name}, ${formatQty(entry.quantity, entry.unit)}`}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-slate-300" />
        {entry.thumbUrl && <img src={entry.thumbUrl} alt="" className="h-10 w-10 rounded-lg object-cover" loading="lazy" />}
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{entry.name}</span>
          <span className="text-sm text-slate-500">buy {formatQty(entry.quantity, entry.unit)} · have {formatQty(entry.currentCount, entry.unit)}</span></span>
        {entry.low && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">low</span>}
        {entry.manual && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">added</span>}
      </button>
      <QtyDialog open={open} title={`How many ${entry.name}?`} initial={entry.quantity} step={entry.unit.step} unitLabel={entry.unit.abbreviation ?? entry.unit.pluralName ?? entry.unit.name}
        onConfirm={(n) => void buy(n)} onClose={() => setOpen(false)} />
    </li>
  );
}

function GroupEntryRow({ hid, entry }: { hid: string; entry: GroupEntry }) {
  const [purchase, { isLoading }] = usePurchaseMutation();
  const [undo] = useUndoEventMutation();
  const { data: inventory } = useGetInventoryQuery(hid);
  const [picker, setPicker] = useState(false);
  const [qtyMember, setQtyMember] = useState<{ itemId: string; name: string; quantity: number; step: number; unitLabel: string } | null>(null);
  const toast = useToast();
  const inFlight = useRef(false);

  const memberQty = (itemId: string) => inventory?.find((i) => i.id === itemId)?.defaultRestockQty ?? 1;
  const memberUnit = (itemId: string) => entry.members.find((m) => m.itemId === itemId)?.unit;

  const buy = async (itemId: string, name: string, quantity?: number) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const r = await purchase({ hid, itemId, ...(quantity !== undefined ? { quantity } : {}) }).unwrap();
      toast.show({
        message: `Got ${name}`,
        actionLabel: 'Undo',
        onAction: () => { undo({ hid, eventId: r.eventId }).unwrap().catch((err) => toast.show({ message: errorMessage(err) })); },
        durationMs: 6000,
      });
    } catch (err) { toast.show({ message: errorMessage(err) }); } finally { inFlight.current = false; }
  };

  const suggestedName = entry.members.find((m) => m.itemId === entry.suggested.itemId)?.name ?? entry.name;
  // Match the backend's sum (groupTotals): untracked members don't count toward the group's
  // total or its low/ok state, so they're excluded here too, both from the ratio and the picker.
  const trackedMembers = entry.members.filter((m) => m.trackLow);
  const inStock = trackedMembers.filter((m) => m.currentCount > 0).length;
  const press = useLongPress(() => setPicker(true), () => void buy(entry.suggested.itemId, suggestedName, entry.suggested.quantity));

  return (
    <li>
      <button type="button" disabled={isLoading} className="flex min-h-14 w-full touch-manipulation items-center gap-3 border-b border-slate-100 bg-white px-3 py-2 text-left active:bg-green-50" {...press}
        aria-label={`Got ${suggestedName}, for ${entry.name}`}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-slate-300" />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{entry.name}</span>
          <span className="text-sm text-slate-500">{inStock} of {trackedMembers.length} in stock · buy {suggestedName}</span></span>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">low</span>
      </button>

      <Dialog.Root open={picker} onOpenChange={setPicker}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl space-y-2 rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Dialog.Title className="text-lg font-semibold">Which one did you buy?</Dialog.Title>
            <Dialog.Description className="sr-only">Choose a member of {entry.name} and set the quantity.</Dialog.Description>
            <ul className="divide-y divide-slate-100">
              {trackedMembers.map((m) => (
                <li key={m.itemId}>
                  <button type="button" className="flex min-h-14 w-full items-center justify-between gap-2 py-2 text-left"
                    onClick={() => {
                      setPicker(false);
                      const unit = memberUnit(m.itemId);
                      setQtyMember({ itemId: m.itemId, name: m.name, quantity: memberQty(m.itemId), step: unit?.step ?? 1, unitLabel: unit?.abbreviation ?? unit?.pluralName ?? unit?.name ?? '' });
                    }}>
                    <span>{m.name}</span>
                    <span className="text-sm text-slate-500">have {formatQty(m.currentCount, m.unit)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <QtyDialog open={!!qtyMember} title={`How many ${qtyMember?.name}?`} initial={qtyMember?.quantity ?? 1} step={qtyMember?.step ?? 1} unitLabel={qtyMember?.unitLabel ?? ''}
        onConfirm={(n) => qtyMember && void buy(qtyMember.itemId, qtyMember.name, n)} onClose={() => setQtyMember(null)} />
    </li>
  );
}

function TextEntryRow({ hid, entry }: { hid: string; entry: TextEntry }) {
  const [check] = useCheckListRowMutation();
  const [remove] = useRemoveListRowMutation();
  const toast = useToast();
  return (
    <li className="flex min-h-14 items-center gap-3 border-b border-slate-100 bg-white px-3 py-2">
      <label className="flex min-h-11 min-w-11 shrink-0 items-center justify-center">
        <input type="checkbox" className="h-7 w-7" checked={entry.checkedOff} aria-label={entry.name}
          onChange={(e) => { check({ hid, id: entry.rowId, checkedOff: e.target.checked }).unwrap().catch((err) => toast.show({ message: errorMessage(err) })); }} />
      </label>
      <span className={`flex-1 ${entry.checkedOff ? 'text-slate-400 line-through' : ''}`}>{entry.name}{entry.quantity ? ` × ${entry.quantity}` : ''}</span>
      <button type="button" aria-label={`Remove ${entry.name}`} className="min-h-11 min-w-11 text-slate-400"
        onClick={() => { remove({ hid, id: entry.rowId }).unwrap().catch((err) => toast.show({ message: errorMessage(err) })); }}>✕</button>
    </li>
  );
}

export function Shopping() {
  const { hid = '' } = useParams();
  const { data, isLoading, isError, error, refetch } = useGetShoppingListQuery(hid, { refetchOnMountOrArgChange: true });
  const { data: stores } = useGetStoresQuery(hid);
  const [addToList] = useAddToListMutation();
  const [name, setName] = useState(''); const [storeId, setStoreId] = useState('');
  const toast = useToast();

  return (
    <div>
      <form className="flex gap-2 p-3" onSubmit={async (e) => {
        e.preventDefault();
        try { await addToList({ hid, body: { name, ...(storeId ? { storeId } : {}) } }).unwrap(); setName(''); } catch (err) { toast.show({ message: errorMessage(err) }); }
      }}>
        <input className="input flex-1" placeholder="Add anything… (birthday candles)" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} aria-label="Add to list" />
        <select className="input w-28" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="Store"><option value="">Any</option>{stores?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button className="btn-primary">Add</button>
      </form>
      {isLoading && <p className="p-4 text-slate-500">Loading…</p>}
      {isError && <QueryError error={error} onRetry={() => void refetch()} />}
      {data?.groups.length === 0 &&<p className="p-8 text-center text-slate-500">All stocked up. 🎉</p>}
      {data?.groups.map((g) => (
        <section key={g.store?.id ?? 'any'}>
          <h2 className="sticky top-[57px] z-10 bg-slate-100 px-3 py-1 text-sm font-semibold uppercase tracking-wide text-slate-600">{g.store?.name ?? 'Any store'}</h2>
          <ul>{g.entries.map((e) =>
            e.kind === 'item' ? <ItemEntryRow key={e.itemId} hid={hid} entry={e} />
            : e.kind === 'group' ? <GroupEntryRow key={e.groupId} hid={hid} entry={e} />
            : <TextEntryRow key={e.rowId} hid={hid} entry={e} />)}</ul>
        </section>
      ))}
      <p className="p-4 text-center text-xs text-slate-400">Tap when it's in the cart — it restocks the usual amount. Hold to change the amount.</p>
    </div>
  );
}
