import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCreateItemMutation, useGetItemQuery, useGetStoresQuery, useGetUnitsQuery, useUpdateItemMutation } from '../api';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/format';

interface FormState {
  name: string; description: string; category: string; unitId: string; preferredStoreId: string; barcode: string;
  currentCount: string; minStock: string; defaultRestockQty: string; renotifyAfterDays: string;
  autoOn: boolean; autoQty: string; autoPeriod: string; autoPaused: boolean;
}
const EMPTY: FormState = {
  name: '', description: '', category: '', unitId: '', preferredStoreId: '', barcode: '', currentCount: '0', minStock: '0',
  defaultRestockQty: '1', renotifyAfterDays: '7', autoOn: false, autoQty: '1', autoPeriod: '1', autoPaused: false,
};

export function ItemForm() {
  const { hid = '', id } = useParams();
  const [params] = useSearchParams();
  const editing = !!id;
  const { data: existing } = useGetItemQuery({ hid, id: id ?? '' }, { skip: !editing });
  const { data: stores } = useGetStoresQuery(hid);
  const { data: units } = useGetUnitsQuery(hid);
  const [createItem, createState] = useCreateItemMutation();
  const [updateItem, updateState] = useUpdateItemMutation();
  const [f, setF] = useState<FormState>({ ...EMPTY, barcode: params.get('barcode') ?? '' });
  const navigate = useNavigate();
  const toast = useToast();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const hydratedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!existing || hydratedFor.current === existing.id) return;
    hydratedFor.current = existing.id;
    setF({
      name: existing.name, description: existing.description ?? '', category: existing.category ?? '', unitId: existing.unit.id,
      preferredStoreId: existing.preferredStoreId ?? '', barcode: existing.barcode ?? '', currentCount: String(existing.currentCount),
      minStock: String(existing.minStock), defaultRestockQty: String(existing.defaultRestockQty), renotifyAfterDays: String(existing.renotifyAfterDays),
      autoOn: existing.autoDeductQty !== null, autoQty: String(existing.autoDeductQty ?? 1), autoPeriod: String(existing.autoDeductPeriodDays),
      autoPaused: existing.autoDeductPaused,
    });
  }, [existing]);
  useEffect(() => {
    if (!editing && !f.unitId && units) set('unitId', units.find((u) => u.global && u.name === 'each')?.id ?? units[0]?.id ?? '');
  }, [editing, f.unitId, units]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const common = {
      name: f.name, description: f.description || null, category: f.category || null, unitId: f.unitId,
      preferredStoreId: f.preferredStoreId || null, barcode: f.barcode || null, minStock: Number(f.minStock),
      defaultRestockQty: Number(f.defaultRestockQty), renotifyAfterDays: Number(f.renotifyAfterDays),
      autoDeductQty: f.autoOn ? Number(f.autoQty) : null, autoDeductPeriodDays: Number(f.autoPeriod), autoDeductPaused: f.autoOn && f.autoPaused,
    };
    try {
      const saved = editing
        ? await updateItem({ hid, id: id!, body: common }).unwrap()
        : await createItem({ hid, body: { ...common, currentCount: Number(f.currentCount) } }).unwrap();
      navigate(`/h/${hid}/items/${saved.id}`, { replace: true });
    } catch (err) { toast.show({ message: errorMessage(err) }); }
  };

  const num = (k: keyof FormState, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block"><span className="label">{label}</span>
      <input className="input" type="number" inputMode="decimal" step="0.001" value={f[k] as string} onChange={(e) => set(k, e.target.value as never)} required {...extra} /></label>
  );

  return (
    <form className="space-y-4 p-4" onSubmit={submit}>
      <h1 className="text-xl font-semibold">{editing ? 'Edit item' : 'New item'}</h1>
      <label className="block"><span className="label">Name</span><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={120} autoFocus={!editing} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Unit</span>
          <select className="input" value={f.unitId} onChange={(e) => set('unitId', e.target.value)} required>
            {units?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select></label>
        <label className="block"><span className="label">Preferred store</span>
          <select className="input" value={f.preferredStoreId} onChange={(e) => set('preferredStoreId', e.target.value)}>
            <option value="">Any store</option>{stores?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        {!editing && num('currentCount', 'Have now', { min: undefined })}
        {num('minStock', 'Minimum to keep', { min: 0 })}
        {num('defaultRestockQty', 'Usually buy', { min: 0.001 })}
        {num('renotifyAfterDays', 'Re-remind every (days)', { min: 1, max: 365, step: 1, inputMode: 'numeric' })}
      </div>
      <label className="block"><span className="label">Category</span><input className="input" value={f.category} onChange={(e) => set('category', e.target.value)} maxLength={60} placeholder="e.g. Pets" /></label>
      <label className="block"><span className="label">Barcode</span><input className="input" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} maxLength={64} inputMode="numeric" /></label>
      <label className="block"><span className="label">Notes</span><textarea className="input min-h-20 py-2" value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} /></label>

      <fieldset className="card space-y-3">
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.autoOn} onChange={(e) => set('autoOn', e.target.checked)} /><span className="font-medium">Uses itself up automatically</span></label>
        {f.autoOn && (<>
          <div className="flex flex-wrap items-center gap-2">
            <span>Uses</span><input aria-label="Amount used per period" className="input w-24" type="number" inputMode="decimal" step="0.001" min={0.001} value={f.autoQty} onChange={(e) => set('autoQty', e.target.value)} required />
            <span>every</span><input aria-label="Period in days" className="input w-24" type="number" inputMode="numeric" step={1} min={1} max={3650} value={f.autoPeriod} onChange={(e) => set('autoPeriod', e.target.value)} required />
            <span>day(s)</span>
          </div>
          <p className="text-sm text-slate-500">e.g. 2 every 1 day for cat food, or 1 every 90 days for a water filter. Changing this restarts the clock from today.</p>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.autoPaused} onChange={(e) => set('autoPaused', e.target.checked)} />Paused</label>
        </>)}
      </fieldset>

      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={() => navigate(-1)}>Cancel</button>
        <button className="btn-primary flex-1" disabled={createState.isLoading || updateState.isLoading}>Save</button>
      </div>
    </form>
  );
}
