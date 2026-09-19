import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ShoppingEntry } from '@plantry/shared';
import {
  useAddToListMutation, useCheckListRowMutation, useGetShoppingListQuery, useGetStoresQuery, usePurchaseMutation, useRemoveListRowMutation, useUndoEventMutation,
} from '../api';
import { QtyDialog } from '../components/QtyDialog';
import { useToast } from '../components/Toast';
import { errorMessage, formatQty } from '../lib/format';
import { useLongPress } from '../lib/useLongPress';

type ItemEntry = Extract<ShoppingEntry, { kind: 'item' }>;
type TextEntry = Extract<ShoppingEntry, { kind: 'text' }>;

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
      <QtyDialog open={open} title={`How many ${entry.name}?`} initial={entry.quantity} unitLabel={entry.unit.abbreviation ?? entry.unit.pluralName ?? entry.unit.name}
        onConfirm={(n) => void buy(n)} onClose={() => setOpen(false)} />
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
  const { data, isLoading } = useGetShoppingListQuery(hid, { refetchOnMountOrArgChange: true });
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
      {data?.groups.length === 0 && <p className="p-8 text-center text-slate-500">All stocked up. 🎉</p>}
      {data?.groups.map((g) => (
        <section key={g.store?.id ?? 'any'}>
          <h2 className="sticky top-[57px] z-10 bg-slate-100 px-3 py-1 text-sm font-semibold uppercase tracking-wide text-slate-600">{g.store?.name ?? 'Any store'}</h2>
          <ul>{g.entries.map((e) => e.kind === 'item' ? <ItemEntryRow key={e.itemId} hid={hid} entry={e} /> : <TextEntryRow key={e.rowId} hid={hid} entry={e} />)}</ul>
        </section>
      ))}
      <p className="p-4 text-center text-xs text-slate-400">Tap when it's in the cart — it restocks the usual amount. Hold to change the amount.</p>
    </div>
  );
}
