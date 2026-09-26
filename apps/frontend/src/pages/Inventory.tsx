import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { type ItemDto } from '@plantry/shared';
import { useConsumeMutation, useGetGroupsQuery, useGetInventoryQuery, useLazyFindByBarcodeQuery, useRestockMutation, useUndoEventMutation } from '../api';
import { ItemRow } from '../components/ItemRow';
import { QueryError } from '../components/QueryError';
import { Scanner } from '../components/Scanner';
import { useToast } from '../components/Toast';
import { errorMessage, formatQty } from '../lib/format';

type ScanMode = 'lookup' | 'use' | 'restock';
const READY_STATUS = 'Ready — scan the next item';

export function Inventory() {
  const { hid = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: items, isLoading, isError, error, refetch } = useGetInventoryQuery(hid);
  const { data: groups } = useGetGroupsQuery(hid);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState<ScanMode | null>(null);
  const [status, setStatus] = useState(READY_STATUS);
  const [match, setMatch] = useState<ItemDto | null>(null);
  const [findByBarcode] = useLazyFindByBarcodeQuery();
  const [restock] = useRestockMutation(); const [consume] = useConsumeMutation(); const [undo] = useUndoEventMutation();
  const quickBusy = useRef(false);
  // Read from onDetected without depending on `mode` in its own deps, so the Scanner's camera
  // effect (keyed off onDetected's identity) doesn't tear down and reacquire when a scan
  // session starts/ends — only the explicit open/close toggles it.
  const modeRef = useRef<ScanMode | null>(null);
  modeRef.current = mode;
  // Per-item apply count for this scan session, shown in the status line ("Applied: X ×n").
  const tallyRef = useRef<Map<string, number>>(new Map());

  const startScan = (m: ScanMode) => {
    tallyRef.current = new Map();
    setStatus(READY_STATUS);
    setMode(m);
    setScanning(true);
  };
  const closeScan = () => { setScanning(false); setMode(null); };

  const onDetected = useCallback(async (code: string) => {
    const m = modeRef.current;
    if (m === 'use' || m === 'restock') {
      try {
        const hits = await findByBarcode({ hid, barcode: code }).unwrap();
        // The user may have cancelled (or the mode may have changed) while the lookup was in
        // flight — bail rather than restocking/consuming into a session that's no longer open.
        if (modeRef.current !== m) return;
        const hit = hits[0];
        if (!hit) { closeScan(); navigate(`/h/${hid}/items/new?barcode=${encodeURIComponent(code)}`); return; }
        const quantity = m === 'restock' ? hit.defaultRestockQty : hit.unit.step;
        const r = await (m === 'restock' ? restock : consume)({ hid, itemId: hit.id, quantity }).unwrap();
        const eventId = r.eventId;
        const count = (tallyRef.current.get(hit.id) ?? 0) + 1;
        tallyRef.current.set(hit.id, count);
        setStatus(`Applied: ${hit.name} ×${count}`);
        navigator.vibrate?.(30);
        toast.show({
          message: `${m === 'restock' ? 'Added' : 'Used'} ${formatQty(quantity, hit.unit)} · ${hit.name}`,
          ...(eventId ? { actionLabel: 'Undo', onAction: () => { undo({ hid, eventId }).unwrap().catch((err) => toast.show({ message: errorMessage(err) })); } } : {}),
          durationMs: 6000,
        });
      } catch (err) { toast.show({ message: errorMessage(err) }); }
      return;
    }
    setScanning(false);
    try {
      const hits = await findByBarcode({ hid, barcode: code }).unwrap();
      if (modeRef.current !== m) return; // cancelled while the lookup was in flight
      if (hits[0]) setMatch(hits[0]); else navigate(`/h/${hid}/items/new?barcode=${encodeURIComponent(code)}`);
    } catch (err) { toast.show({ message: errorMessage(err) }); }
  }, [findByBarcode, hid, navigate, toast, restock, consume, undo]);

  const quick = async (kind: 'restock' | 'consume') => {
    if (!match || quickBusy.current) return;
    quickBusy.current = true;
    const quantity = kind === 'restock' ? match.defaultRestockQty : match.unit.step;
    try { await (kind === 'restock' ? restock : consume)({ hid, itemId: match.id, quantity }).unwrap(); toast.show({ message: `${kind === 'restock' ? 'Added' : 'Used'} ${formatQty(quantity, match.unit)} · ${match.name}` }); }
    catch (err) { toast.show({ message: errorMessage(err) }); }
    quickBusy.current = false;
    setMatch(null);
  };

  const categories = useMemo(() => [...new Set((items ?? []).map((i) => i.category).filter((c): c is string => !!c))].sort(), [items]);
  // Brief C: "Low" includes items nagging on their own, plus members of a low group — a grouped
  // item's own `nagging` is always false (the group nags for it), so it needs a separate check.
  const lowGroupIds = useMemo(() => new Set((groups ?? []).filter((g) => g.low).map((g) => g.id)), [groups]);
  const isLowForFilter = (i: ItemDto) => i.nagging || (!!i.groupId && lowGroupIds.has(i.groupId));
  const shown = (items ?? []).filter((i) =>
    (!q || i.name.toLowerCase().includes(q.toLowerCase())) && (!category || i.category === category) && (!lowOnly || isLowForFilter(i)));
  const chip = (active: boolean) => `min-h-9 whitespace-nowrap rounded-full border px-3 text-sm ${active ? 'border-green-800 bg-green-800 text-white' : 'border-slate-300 bg-white'}`;

  return (
    <div>
      <div className="sticky top-[57px] z-20 space-y-2 bg-slate-50 p-3">
        <div className="flex flex-wrap gap-2" id="inventory-toolbar">
          <input className="input" type="search" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
          <button type="button" aria-label="Scan to look up" className="btn-ghost whitespace-nowrap" onClick={() => startScan('lookup')}>Scan</button>
          <button type="button" aria-label="Scan to use" className="btn-ghost whitespace-nowrap" onClick={() => startScan('use')}>Scan · Use</button>
          <button type="button" aria-label="Scan to restock" className="btn-ghost whitespace-nowrap" onClick={() => startScan('restock')}>Scan · Restock</button>
          <Link to={`/h/${hid}/items/new`} className="btn-primary whitespace-nowrap">+ New</Link>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <button type="button" className={chip(lowOnly)} aria-pressed={lowOnly} onClick={() => setLowOnly((v) => !v)}>Low</button>
          {categories.map((c) => <button type="button" key={c} className={chip(category === c)} aria-pressed={category === c} onClick={() => setCategory(category === c ? null : c)}>{c}</button>)}
        </div>
      </div>
      {isLoading && <p className="p-4 text-slate-500">Loading…</p>}
      {isError && <QueryError error={error} onRetry={() => void refetch()} />}
      {items && items.length === 0 &&<p className="p-8 text-center text-slate-500">Nothing here yet. Add your first item.</p>}
      <ul>{shown.map((i) => <ItemRow key={i.id} hid={hid} item={i} />)}</ul>
      <Scanner open={scanning} continuous={mode === 'use' || mode === 'restock'} status={status} onDetected={onDetected} onClose={closeScan} />
      <Dialog.Root open={!!match} onOpenChange={(o) => !o && setMatch(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl space-y-2 rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Dialog.Title className="text-lg font-semibold">{match?.name}</Dialog.Title>
            <Dialog.Description className="text-slate-500">{match && `Have ${formatQty(match.currentCount, match.unit)}`}</Dialog.Description>
            <button className="btn-primary w-full" onClick={() => void quick('restock')}>Restock {match && formatQty(match.defaultRestockQty, match.unit)}</button>
            <button className="btn-ghost w-full" onClick={() => void quick('consume')}>Use {match && formatQty(match.unit.step, match.unit)}</button>
            <button className="btn-ghost w-full" onClick={() => { if (match) navigate(`/h/${hid}/items/${match.id}`); }}>Open item</button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
