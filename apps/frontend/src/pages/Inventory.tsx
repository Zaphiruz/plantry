import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { type ItemDto } from '@plantry/shared';
import { useConsumeMutation, useGetInventoryQuery, useLazyFindByBarcodeQuery, useRestockMutation } from '../api';
import { ItemRow } from '../components/ItemRow';
import { QueryError } from '../components/QueryError';
import { Scanner } from '../components/Scanner';
import { useToast } from '../components/Toast';
import { errorMessage, formatQty } from '../lib/format';

export function Inventory() {
  const { hid = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: items, isLoading, isError, error, refetch } = useGetInventoryQuery(hid);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [match, setMatch] = useState<ItemDto | null>(null);
  const [findByBarcode] = useLazyFindByBarcodeQuery();
  const [restock] = useRestockMutation(); const [consume] = useConsumeMutation();
  const quickBusy = useRef(false);

  const onDetected = useCallback(async (code: string) => {
    setScanning(false);
    try {
      const hits = await findByBarcode({ hid, barcode: code }).unwrap();
      if (hits[0]) setMatch(hits[0]); else navigate(`/h/${hid}/items/new?barcode=${encodeURIComponent(code)}`);
    } catch (err) { toast.show({ message: errorMessage(err) }); }
  }, [findByBarcode, hid, navigate, toast]);

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
  const shown = (items ?? []).filter((i) =>
    (!q || i.name.toLowerCase().includes(q.toLowerCase())) && (!category || i.category === category) && (!lowOnly || i.low));
  const chip = (active: boolean) => `min-h-9 whitespace-nowrap rounded-full border px-3 text-sm ${active ? 'border-green-800 bg-green-800 text-white' : 'border-slate-300 bg-white'}`;

  return (
    <div>
      <div className="sticky top-[57px] z-20 space-y-2 bg-slate-50 p-3">
        <div className="flex gap-2" id="inventory-toolbar">
          <input className="input" type="search" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
          <button type="button" className="btn-ghost whitespace-nowrap" onClick={() => setScanning(true)}>Scan</button>
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
      <Scanner open={scanning} onDetected={onDetected} onClose={() => setScanning(false)} />
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
