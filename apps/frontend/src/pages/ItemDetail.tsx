import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RATE_WINDOWS, type EventDto, type RateWindow } from '@plantry/shared';
import {
  useAddToListMutation, useAdjustMutation, useArchiveItemMutation, useConsolidateMutation, useDeleteItemMutation, useGetEventsQuery,
  useGetInventoryQuery, useGetItemQuery, useGetMeQuery, useGetRateQuery, useLazyFindByBarcodeQuery, useRemoveListRowMutation,
  useUnarchiveItemMutation, useUndoEventMutation, useUpdateItemMutation,
} from '../api';
import { PhotoPicker } from '../components/PhotoPicker';
import { QtyDialog } from '../components/QtyDialog';
import { QueryError } from '../components/QueryError';
import { Scanner } from '../components/Scanner';
import { useToast } from '../components/Toast';
import { defaultWindowFor, errorMessage, formatQty } from '../lib/format';

const EVENT_LABEL = { restock: 'Restocked', consume: 'Used', adjust: 'Adjusted', auto_deduct: 'Auto-used' } as const;

/**
 * The history pages loaded so far. `key` identifies the run (item id + newest event of page 0);
 * when the head of the list changes, the accumulated tail is stale and is thrown away.
 */
interface History { key: string; cursors: (string | undefined)[]; pages: EventDto[][] }
const EMPTY_HISTORY: History = { key: '', cursors: [], pages: [] };

export function ItemDetail() {
  const { hid = '', id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: me } = useGetMeQuery();
  const { data: item, isError: itemFailed, error: itemError, refetch: refetchItem } = useGetItemQuery({ hid, id });
  const { data: others } = useGetInventoryQuery(hid);
  const [rateWindow, setRateWindow] = useState<RateWindow | null>(null);
  const effectiveWindow = rateWindow ?? defaultWindowFor(item?.autoDeductPeriodDays ?? 1, item?.autoDeductQty != null);
  const { data: rate } = useGetRateQuery({ hid, id, window: effectiveWindow }, { skip: !item || !!item.archivedAt });

  // History paging: "Older" appends a page instead of replacing the one on screen.
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [loadedFor, setLoadedFor] = useState(id);
  let activeCursor = cursor;
  if (loadedFor !== id) { // a different item: drop the accumulated tail before it can be queried
    setLoadedFor(id); setCursor(undefined); setHistory(EMPTY_HISTORY); activeCursor = undefined;
  }
  // `currentData` (not `data`): while the args are switching, `data` still holds the PREVIOUS
  // page, which would be appended a second time under the new cursor.
  const { currentData: events } = useGetEventsQuery({ hid, itemId: id, ...(activeCursor ? { cursor: activeCursor } : {}) });
  useEffect(() => {
    if (!events) return;
    setHistory((prev) => {
      if (activeCursor === undefined) {
        const key = `${id}:${events.events[0]?.id ?? 'none'}`;
        // Same head → this is a refetch of page 0; keep the tail and refresh page 0 in place.
        if (prev.key === key) return { ...prev, pages: prev.pages.map((p, i) => (i === 0 ? events.events : p)) };
        return { key, cursors: [undefined], pages: [events.events] };
      }
      const at = prev.cursors.indexOf(activeCursor);
      if (at !== -1) return { ...prev, pages: prev.pages.map((p, i) => (i === at ? events.events : p)) };
      return { ...prev, cursors: [...prev.cursors, activeCursor], pages: [...prev.pages, events.events] };
    });
  }, [events, activeCursor, id]);
  const rows = history.pages.flat();

  const [adjust] = useAdjustMutation(); const [undo] = useUndoEventMutation();
  const [archive] = useArchiveItemMutation(); const [unarchive] = useUnarchiveItemMutation();
  const [del] = useDeleteItemMutation(); const [consolidate] = useConsolidateMutation();
  const [addToList] = useAddToListMutation(); const [removeRow] = useRemoveListRowMutation();
  const [updateItem] = useUpdateItemMutation(); const [findByBarcode] = useLazyFindByBarcodeQuery();
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const scanBusy = useRef(false);
  const [mergeTarget, setMergeTarget] = useState(''); const [keepMin, setKeepMin] = useState<'target' | 'source'>('target');

  // Latest item, readable from the stable callback below without making it depend on `item`
  // (which would give Scanner a new `onDetected` identity every refetch and tear its camera down).
  // Updated from the mutation's own response too, so a second scan fired before the refetch lands
  // still builds its `barcodes` list on top of the first scan's result, not stale render state.
  const itemRef = useRef(item);
  itemRef.current = item;

  // Defined above the early returns below: hooks must run unconditionally on every render.
  const onScanned = useCallback((code: string) => {
    setScanning(false);
    if (scanBusy.current) return;
    const current = itemRef.current;
    if (!current) return;
    scanBusy.current = true;
    void (async () => {
      try {
        if (current.barcodes.includes(code)) { toast.show({ message: 'Already on this item' }); return; }
        const hits = await findByBarcode({ hid, barcode: code }).unwrap();
        const owner = hits.find((h) => h.id !== current.id);
        if (owner) { toast.show({ message: `Already used by ${owner.name}` }); return; }
        const updated = await updateItem({ hid, id, body: { barcodes: [...current.barcodes, code] } }).unwrap();
        itemRef.current = updated;
        toast.show({ message: 'Barcode added' });
      } catch (err) { toast.show({ message: errorMessage(err) }); }
      finally { scanBusy.current = false; }
    })();
  }, [hid, id, findByBarcode, updateItem, toast]);

  if (itemFailed && !item) {
    const gone = (itemError as { status?: number } | undefined)?.status === 404;
    return gone
      ? (
        <QueryError error={{ data: { error: { message: 'This item no longer exists.' } } }}>
          <Link className="btn-ghost inline-block" to={`/h/${hid}`}>Back to inventory</Link>
        </QueryError>
      )
      : <QueryError error={itemError} onRetry={() => void refetchItem()} />;
  }
  if (!item) return <p className="p-4 text-slate-500">Loading…</p>;
  const run = async (fn: () => Promise<unknown>, after?: () => void) => { try { await fn(); after?.(); } catch (err) { toast.show({ message: errorMessage(err) }); } };
  const unitLabel = item.unit.abbreviation ?? item.unit.pluralName ?? item.unit.name;
  const archived = !!item.archivedAt;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-3">
        {!archived && <PhotoPicker hid={hid} item={item} />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{item.name}</h1>
          <p className={item.low ? 'font-semibold text-red-700' : 'text-slate-600'}>{formatQty(item.currentCount, item.unit)} · keep at least {formatQty(item.minStock, item.unit)}</p>
          {archived && <p className="text-sm font-medium text-amber-700">Archived</p>}
          {item.description && <p className="mt-1 text-sm text-slate-500">{item.description}</p>}
          <p className="mt-1 font-mono text-xs text-slate-500">{item.barcodes.length > 0 ? item.barcodes.join(', ') : 'No barcodes'}</p>
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
          <button className="btn-ghost" onClick={() => setScanning(true)}>Scan barcode</button>
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
          {rows.map((e) => (
            <li key={e.id} className="flex justify-between gap-2 py-2">
              <span>{EVENT_LABEL[e.eventType]} {e.eventType === 'adjust' && e.quantity > 0 ? '+' : ''}{formatQty(e.quantity, item.unit)}{e.note ? ` · ${e.note}` : ''}</span>
              <span className="whitespace-nowrap text-slate-500">{e.userName ?? 'auto'} · {new Date(e.createdAt).toLocaleDateString()}</span>
            </li>
          ))}
          {history.key !== '' && rows.length === 0 && <li className="py-2 text-slate-500">No history yet.</li>}
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

      <QtyDialog open={adjustOpen} title={`How many ${item.name} are there really?`} initial={item.currentCount} step={item.unit.step} unitLabel={unitLabel} allowNegative
        onConfirm={(n) => run(async () => {
          const { eventId } = await adjust({ hid, itemId: id, newCount: n }).unwrap();
          toast.show({
            message: `Set to ${formatQty(n, item.unit)} · ${item.name}`,
            ...(eventId ? { actionLabel: 'Undo', onAction: () => { undo({ hid, eventId }).unwrap().catch((err) => toast.show({ message: errorMessage(err) })); } } : {}),
            durationMs: 6000,
          });
        })} onClose={() => setAdjustOpen(false)} />
      <Scanner open={scanning} onDetected={onScanned} onClose={() => setScanning(false)} />
    </div>
  );
}
