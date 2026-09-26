import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCreateItemMutation, useGetItemQuery, useGetStoresQuery, useGetUnitsQuery, useUpdateItemMutation } from '../api';
import { Scanner } from '../components/Scanner';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/format';

interface FormState {
  name: string; description: string; category: string; unitId: string; preferredStoreId: string; barcodes: string[];
  currentCount: string; minStock: string; defaultRestockQty: string; renotifyAfterDays: string;
  autoOn: boolean; autoQty: string; autoPeriod: string; autoPaused: boolean; trackLow: boolean;
}
const EMPTY: FormState = {
  name: '', description: '', category: '', unitId: '', preferredStoreId: '', barcodes: [], currentCount: '0', minStock: '0',
  defaultRestockQty: '1', renotifyAfterDays: '7', autoOn: false, autoQty: '1', autoPeriod: '1', autoPaused: false, trackLow: true,
};

const threeDp = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
const isPositiveQty = (n: number) => Number.isFinite(n) && n > 0 && threeDp(n);
const isNonNegQty = (n: number) => Number.isFinite(n) && n >= 0 && threeDp(n);

export function ItemForm() {
  const { hid = '', id } = useParams();
  const [params] = useSearchParams();
  const editing = !!id;
  const { data: existing } = useGetItemQuery({ hid, id: id ?? '' }, { skip: !editing });
  const { data: stores } = useGetStoresQuery(hid);
  const { data: units } = useGetUnitsQuery(hid);
  const [createItem, createState] = useCreateItemMutation();
  const [updateItem, updateState] = useUpdateItemMutation();
  const seedBarcode = params.get('barcode');
  const [f, setF] = useState<FormState>({ ...EMPTY, barcodes: seedBarcode ? [seedBarcode] : [] });
  const [formError, setFormError] = useState<string | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeError, setBarcodeError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const hydratedFor = useRef<string | null>(null);
  const restockTouched = useRef(false);

  const addBarcode = (raw: string) => {
    const code = raw.trim();
    if (!code) { setBarcodeError('Enter a barcode'); return; }
    if (f.barcodes.includes(code)) { setBarcodeError('This barcode is already on the list'); return; }
    setBarcodeError(null);
    setF((s) => ({ ...s, barcodes: [...s.barcodes, code] }));
    setBarcodeInput('');
  };
  const removeBarcode = (code: string) => setF((s) => ({ ...s, barcodes: s.barcodes.filter((c) => c !== code) }));
  // Stable identity: Scanner's camera-acquisition effect depends on `onDetected`, so a new
  // function here on every render would tear down and re-acquire the camera mid-scan.
  const onScanned = useCallback((code: string) => {
    setScanning(false);
    setF((s) => (s.barcodes.includes(code) ? s : { ...s, barcodes: [...s.barcodes, code] }));
  }, []);
  const selectedUnit = units?.find((u) => u.id === f.unitId);
  const unitStep = selectedUnit?.step ?? 1;

  useEffect(() => {
    if (!existing || hydratedFor.current === existing.id) return;
    hydratedFor.current = existing.id;
    setF({
      name: existing.name, description: existing.description ?? '', category: existing.category ?? '', unitId: existing.unit.id,
      preferredStoreId: existing.preferredStoreId ?? '', barcodes: existing.barcodes, currentCount: String(existing.currentCount),
      minStock: String(existing.minStock), defaultRestockQty: String(existing.defaultRestockQty), renotifyAfterDays: String(existing.renotifyAfterDays),
      autoOn: existing.autoDeductQty !== null, autoQty: String(existing.autoDeductQty ?? 1), autoPeriod: String(existing.autoDeductPeriodDays),
      autoPaused: existing.autoDeductPaused, trackLow: existing.trackLow,
    });
  }, [existing]);
  useEffect(() => {
    if (!editing && !f.unitId && units) set('unitId', units.find((u) => u.global && u.name === 'each')?.id ?? units[0]?.id ?? '');
  }, [editing, f.unitId, units]);
  // New item, unit changed, "Usually buy" not hand-edited yet: default it to the new unit's step.
  useEffect(() => {
    if (editing || restockTouched.current || !selectedUnit) return;
    setF((s) => ({ ...s, defaultRestockQty: String(selectedUnit.step) }));
  }, [editing, selectedUnit]);

  const validate = (): string | null => {
    if (!f.name.trim()) return 'Name is required';
    if (!f.unitId) return 'Unit is required';
    if (f.minStock.trim() === '') return 'Minimum to keep is required';
    const minStock = Number(f.minStock);
    if (!isNonNegQty(minStock)) return 'Minimum to keep must be 0 or more, with at most 3 decimal places';
    const defaultRestockQty = Number(f.defaultRestockQty);
    if (!isPositiveQty(defaultRestockQty)) return 'Usually buy must be a positive number with at most 3 decimal places';
    if (!editing) {
      if (f.currentCount.trim() === '') return 'Have now is required';
      const currentCount = Number(f.currentCount);
      if (!Number.isFinite(currentCount) || !threeDp(currentCount)) return 'Have now must be a number with at most 3 decimal places';
    }
    const renotifyAfterDays = Number(f.renotifyAfterDays);
    if (!Number.isInteger(renotifyAfterDays) || renotifyAfterDays < 1 || renotifyAfterDays > 365) return 'Re-remind every (days) must be a whole number between 1 and 365';
    const autoPeriod = Number(f.autoPeriod);
    if (!Number.isInteger(autoPeriod) || autoPeriod < 1 || autoPeriod > 3650) return 'The auto-deduct period must be a whole number of days';
    if (f.autoOn) {
      const autoQty = Number(f.autoQty);
      if (!isPositiveQty(autoQty)) return 'The auto-deduct amount must be a positive number with at most 3 decimal places';
    }
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const error = validate();
    setFormError(error);
    if (error) return;
    const common = {
      name: f.name, description: f.description || null, category: f.category || null, unitId: f.unitId,
      preferredStoreId: f.preferredStoreId || null, barcodes: f.barcodes, minStock: Number(f.minStock),
      defaultRestockQty: Number(f.defaultRestockQty), renotifyAfterDays: Number(f.renotifyAfterDays),
      autoDeductQty: f.autoOn ? Number(f.autoQty) : null, autoDeductPeriodDays: Number(f.autoPeriod), autoDeductPaused: f.autoOn && f.autoPaused,
      trackLow: f.trackLow,
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
      <input className="input" type="number" inputMode="decimal" step={unitStep}
        value={f[k] as string}
        onChange={(e) => { if (k === 'defaultRestockQty') restockTouched.current = true; set(k, e.target.value as never); }}
        {...extra} /></label>
  );

  return (
    <form className="space-y-4 p-4" noValidate onSubmit={submit}>
      <h1 className="text-xl font-semibold">{editing ? 'Edit item' : 'New item'}</h1>
      <label className="block"><span className="label">Name</span><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} autoFocus={!editing} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className="label">Unit</span>
          <select className="input" value={f.unitId} onChange={(e) => set('unitId', e.target.value)}>
            {units?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select></label>
        <label className="block"><span className="label">Preferred store</span>
          <select className="input" value={f.preferredStoreId} onChange={(e) => set('preferredStoreId', e.target.value)}>
            <option value="">Any store</option>{stores?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        {!editing && num('currentCount', 'Have now')}
        {num('minStock', 'Minimum to keep', { min: 0 })}
        {num('defaultRestockQty', 'Usually buy', { min: unitStep })}
        {num('renotifyAfterDays', 'Re-remind every (days)', { min: 1, max: 365, step: 1, inputMode: 'numeric' })}
      </div>
      <label className="block"><span className="label">Category</span><input className="input" value={f.category} onChange={(e) => set('category', e.target.value)} maxLength={60} placeholder="e.g. Pets" /></label>
      <div className="space-y-1">
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.trackLow} onChange={(e) => set('trackLow', e.target.checked)} /><span className="font-medium">Remind me when this runs low</span></label>
        <p className="text-sm text-slate-500">Off: no notifications and it never appears on the shopping list automatically. You can still add it to a trip by hand.</p>
      </div>
      <div className="space-y-2">
        <span className="label">Barcodes</span>
        {f.barcodes.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {f.barcodes.map((code) => (
              <li key={code} className="flex min-h-11 items-center gap-1 rounded-full border border-slate-300 bg-white pl-3 pr-1 text-sm">
                <span>{code}</span>
                <button type="button" aria-label={`Remove barcode ${code}`} className="flex h-11 w-11 items-center justify-center text-slate-500" onClick={() => removeBarcode(code)}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <label className="flex-1"><span className="sr-only">Add barcode</span>
            <input className="input" aria-label="Add barcode" inputMode="numeric" maxLength={64} value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addBarcode(barcodeInput); } }} />
          </label>
          <button type="button" className="btn-ghost" onClick={() => addBarcode(barcodeInput)}>Add</button>
          <button type="button" className="btn-ghost" onClick={() => setScanning(true)}>Scan</button>
        </div>
        {barcodeError && <p role="alert" className="text-sm font-medium text-red-700">{barcodeError}</p>}
      </div>
      <Scanner open={scanning} onDetected={onScanned} onClose={() => setScanning(false)} />
      <label className="block"><span className="label">Notes</span><textarea className="input min-h-20 py-2" value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={1000} /></label>

      <fieldset className="card space-y-3">
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.autoOn} onChange={(e) => set('autoOn', e.target.checked)} /><span className="font-medium">Uses itself up automatically</span></label>
        {f.autoOn && (<>
          <div className="flex flex-wrap items-center gap-2">
            <span>Uses</span><input aria-label="Amount used per period" className="input w-24" type="number" inputMode="decimal" step={unitStep} min={unitStep} value={f.autoQty} onChange={(e) => set('autoQty', e.target.value)} />
            <span>every</span><input aria-label="Period in days" className="input w-24" type="number" inputMode="numeric" step={1} min={1} max={3650} value={f.autoPeriod} onChange={(e) => set('autoPeriod', e.target.value)} />
            <span>day(s)</span>
          </div>
          <p className="text-sm text-slate-500">e.g. 2 every 1 day for cat food, or 1 every 90 days for a water filter. Changing this restarts the clock from today.</p>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={f.autoPaused} onChange={(e) => set('autoPaused', e.target.checked)} />Paused</label>
        </>)}
      </fieldset>

      {formError && <p role="alert" className="text-sm font-medium text-red-700">{formError}</p>}

      <div className="flex gap-2">
        <button type="button" className="btn-ghost flex-1" onClick={() => navigate(-1)}>Cancel</button>
        <button className="btn-primary flex-1" disabled={createState.isLoading || updateState.isLoading}>Save</button>
      </div>
    </form>
  );
}
