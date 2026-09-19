import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGetInventoryQuery } from '../api';
import { ItemRow } from '../components/ItemRow';

export function Inventory() {
  const { hid = '' } = useParams();
  const { data: items, isLoading } = useGetInventoryQuery(hid);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(false);

  const categories = useMemo(() => [...new Set((items ?? []).map((i) => i.category).filter((c): c is string => !!c))].sort(), [items]);
  const shown = (items ?? []).filter((i) =>
    (!q || i.name.toLowerCase().includes(q.toLowerCase())) && (!category || i.category === category) && (!lowOnly || i.low));
  const chip = (active: boolean) => `min-h-9 whitespace-nowrap rounded-full border px-3 text-sm ${active ? 'border-green-800 bg-green-800 text-white' : 'border-slate-300 bg-white'}`;

  return (
    <div>
      <div className="sticky top-[57px] z-20 space-y-2 bg-slate-50 p-3">
        <div className="flex gap-2" id="inventory-toolbar">
          <input className="input" type="search" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
          <Link to={`/h/${hid}/items/new`} className="btn-primary whitespace-nowrap">+ New</Link>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <button type="button" className={chip(lowOnly)} onClick={() => setLowOnly((v) => !v)}>Low</button>
          {categories.map((c) => <button type="button" key={c} className={chip(category === c)} onClick={() => setCategory(category === c ? null : c)}>{c}</button>)}
        </div>
      </div>
      {isLoading && <p className="p-4 text-slate-500">Loading…</p>}
      {items && items.length === 0 && <p className="p-8 text-center text-slate-500">Nothing here yet. Add your first item.</p>}
      <ul>{shown.map((i) => <ItemRow key={i.id} hid={hid} item={i} />)}</ul>
    </div>
  );
}
