import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RATE_WINDOWS, type RateWindow } from '@plantry/shared';
import {
  useAddToListMutation, useAdjustMutation, useArchiveItemMutation, useConsolidateMutation, useDeleteItemMutation, useGetEventsQuery,
  useGetInventoryQuery, useGetItemQuery, useGetMeQuery, useGetRateQuery, useRemoveListRowMutation, useUnarchiveItemMutation,
} from '../api';
import { QtyDialog } from '../components/QtyDialog';
import { useToast } from '../components/Toast';
import { defaultWindowFor, errorMessage, formatQty } from '../lib/format';

const EVENT_LABEL = { restock: 'Restocked', consume: 'Used', adjust: 'Adjusted', auto_deduct: 'Auto-used' } as const;

export function ItemDetail() {
  const { hid = '', id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: me } = useGetMeQuery();
  const { data: item } = useGetItemQuery({ hid, id });
  const { data: others } = useGetInventoryQuery(hid);
  const [rateWindow, setRateWindow] = useState<RateWindow | null>(null);
  const effectiveWindow = rateWindow ?? defaultWindowFor(item?.autoDeductPeriodDays ?? 1, item?.autoDeductQty != null);
  const { data: rate } = useGetRateQuery({ hid, id, window: effectiveWindow }, { skip: !item || !!item.archivedAt });
  const [cursor, setCursor] = useState<string | undefined>();
  const { data: events } = useGetEventsQuery({ hid, itemId: id, ...(cursor ? { cursor } : {}) });
  const [adjust] = useAdjustMutation(); const [archive] = useArchiveItemMutation(); const [unarchive] = useUnarchiveItemMutation();
  const [del] = useDeleteItemMutation(); const [consolidate] = useConsolidateMutation();
  const [addToList] = useAddToListMutation(); const [removeRow] = useRemoveListRowMutation();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState(''); const [keepMin, setKeepMin] = useState<'target' | 'source'>('target');

  if (!item) return <p className="p-4 text-slate-500">Loading…</p>;
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { try { await fn(); after?.(); } catch (err) { toast.show({ message: errorMessage(err) }); } };
  const unitLabel = item.unit.abbreviation ?? item.unit.pluralName ?? item.unit.name;
  const archived = !!item.archivedAt;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-3">
        <div id="photo-slot" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{item.name}</h1>
          <p className={item.low ? 'font-semibold text-red-700' : 'text-slate-600'}>{formatQty(item.currentCount, item.unit)} · keep at least {formatQty(item.minStock, item.unit)}</p>
          {archived && <p className="text-sm font-medium text-amber-700">Archived</p>}
          {item.description && <p className="mt-1 text-sm text-slate-500">{item.description}</p>}
        </div>
        {!archived && <Link className="btn-ghost" to="edit">Edit</Link>}
      </div>

      {!archived && (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-ghost" onClick={() => setAdjustOpen(true)}>Correct count</button>
          <button className={item.nextTripRowId ? 'btn-primary' : 'btn-ghost'} aria-pressed={!!item.nextTripRowId}
            onClick={() => run(() => item.nextTripRowId ? removeRow({ hid, id: item.nextTripRowId }).unwrap() : addToList({ hid, body: { itemId: item.id } }).unwrap())}>
            {item.nextTripRowId ? 'On next trip ✓' : 'Add to next trip'}
          </button>
        </div>
      )}

      {item.autoDeductQty !== null && (
        <p className="card text-sm">Uses {formatQty(item.autoDeductQty, item.unit)} every {item.autoDeductPeriodDays} day(s){item.autoDeductPaused && ' — paused'}</p>
      )}

      {!archived && (
        <section className="card space-y-2">
          <div className="flex items-center justify-between"><h2 className="font-medium">Usage</h2>
            <select aria-label="Rate window" className="input w-auto" value={effectiveWindow} onChange={(e) => setRateWindow(e.target.value as RateWindow)}>
              {RATE_WINDOWS.map((w) => <option key={w} value={w}>{w === '183d' ? '6 months' : w === '365d' ? '1 year' : `${w.slice(0, -1)} days`}</option>)}
            </select></div>
          <p className="text-slate-700">{rate ? `${Math.round(rate.avgPerDay * 7 * 100) / 100} ${unitLabel} / week` : '…'}
            {rate && rate.avgPerDay > 0 && item.currentCount > 0 && <span className="text-slate-500"> · about {Math.round(item.currentCount / rate.avgPerDay)} days left</span>}</p>
        </section>
      )}

      <section className="card space-y-2">
        <h2 className="font-medium">History</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {events?.events.map((e) => (
            <li key={e.id} className="flex justify-between gap-2 py-2">
              <span>{EVENT_LABEL[e.eventType]} {e.eventType === 'adjust' && e.quantity > 0 ? '+' : ''}{formatQty(e.quantity, item.unit)}{e.note ? ` · ${e.note}` : ''}</span>
              <span className="whitespace-nowrap text-slate-500">{e.userName ?? 'auto'} · {new Date(e.createdAt).toLocaleDateString()}</span>
            </li>
          ))}
          {events?.events.length === 0 && <li className="py-2 text-slate-500">No history yet.</li>}
        </ul>
        {events?.nextCursor && <button className="btn-ghost w-full" onClick={() => setCursor(events.nextCursor!)}>Older</button>}
      </section>

      {!archived && (
        <section className="card space-y-2">
          <h2 className="font-medium">Merge a duplicate into this item</h2>
          <p className="text-sm text-slate-500">The other item's history and count move here; it gets archived (recoverable).</p>
          <select aria-label="Duplicate item" className="input" value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}>
            <option value="">Choose the duplicate…</option>
            {others?.filter((o) => o.id !== item.id).map((o) => <option key={o.id} value={o.id}>{o.name} ({formatQty(o.currentCount, o.unit)})</option>)}
          </select>
          {mergeTarget && (<>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={keepMin === 'source'} onChange={(e) => setKeepMin(e.target.checked ? 'source' : 'target')} />Use the duplicate's minimum instead</label>
            <button className="btn-primary w-full" onClick={() => run(() => consolidate({ hid, targetId: item.id, sourceId: mergeTarget, keepMinStockFrom: keepMin }).unwrap(), () => { setMergeTarget(''); toast.show({ message: 'Merged' }); })}>Merge into {item.name}</button>
          </>)}
        </section>
      )}

      <section className="space-y-2">
        {!archived && <button className="btn-ghost w-full" onClick={() => run(() => archive({ hid, id }).unwrap(), () => navigate(`/h/${hid}`))}>Archive</button>}
        {archived && <button className="btn-ghost w-full" onClick={() => run(() => unarchive({ hid, id }).unwrap())}>Restore from archive</button>}
        {archived && me?.user.isAdmin && (
          <button className="btn-danger w-full" onClick={() => { if (confirm(`Permanently delete "${item.name}" and all its history? This cannot be undone.`)) void run(() => del({ hid, id }).unwrap(), () => navigate(`/h/${hid}/settings`)); }}>Delete permanently</button>
        )}
      </section>

      <QtyDialog open={adjustOpen} title={`How many ${item.name} are there really?`} initial={item.currentCount} unitLabel={unitLabel} allowNegative
        onConfirm={(n) => run(() => adjust({ hid, itemId: id, newCount: n }).unwrap())} onClose={() => setAdjustOpen(false)} />
    </div>
  );
}
