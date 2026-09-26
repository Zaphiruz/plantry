import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { UnitDto } from '@plantry/shared';
import {
  useCreateGroupMutation, useCreateInviteMutation, useCreateStoreMutation, useCreateUnitMutation, useDeleteGroupMutation, useDeleteStoreMutation,
  useDeleteUnitMutation, useGetArchivedItemsQuery, useGetGroupsQuery, useGetInventoryQuery,
  useGetMeQuery, useGetMembersQuery, useGetMyFeedbackQuery, useGetStoresQuery, useGetUnitsQuery, useGetVapidKeyQuery, useLeaveHouseholdMutation,
  useLogoutMutation, usePushSubscribeMutation, usePushUnsubscribeMutation, useRemoveMemberMutation, useRenameHouseholdMutation,
  useSendFeedbackMutation, useSetMemberRoleMutation, useUnarchiveItemMutation, useUpdateGroupMutation, useUpdateUnitMutation,
} from '../api';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/format';
import { currentSubscription, needsIosInstall, pushSupported, subscribePush, unsubscribePush } from '../lib/push';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="card space-y-3"><h2 className="font-semibold">{title}</h2>{children}</section>
);

const twoDp = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const isValidStep = (n: number) => Number.isFinite(n) && n >= 0.01 && twoDp(n);

/**
 * Inline step editor. Hydrates from the server value once per unit id, and re-syncs from
 * `unit.step` whenever the field is idle (not focused, not hand-edited) — e.g. a background
 * refetch (refetchOnFocus) picking up a change made on another device. `dirtyRef` tracks a
 * real, unsaved edit: it's what makes `save()` a no-op on a plain focus+blur, so an idle field
 * showing a value it never PATCHed can't write that value back over a newer server value.
 * Saves on blur/Enter, and guards against a double submit (e.g. blur firing right after Enter).
 */
function UnitStepEditor({ hid, unit, onError }: { hid: string; unit: UnitDto; onError(msg: string): void }) {
  const [updateUnit] = useUpdateUnitMutation();
  const [value, setValue] = useState(String(unit.step));
  const hydratedFor = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const focusedRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (hydratedFor.current !== unit.id) {
      hydratedFor.current = unit.id;
      dirtyRef.current = false;
      setValue(String(unit.step));
      return;
    }
    if (!focusedRef.current && !dirtyRef.current) setValue(String(unit.step));
  }, [unit.id, unit.step]);

  const save = async () => {
    if (savingRef.current || !dirtyRef.current) return;
    const n = Number(value);
    if (!isValidStep(n)) {
      dirtyRef.current = false;
      setValue(String(unit.step));
      onError('Step must be a number of at least 0.01, with at most 2 decimal places');
      return;
    }
    if (n === unit.step) { dirtyRef.current = false; return; }
    savingRef.current = true;
    try { await updateUnit({ hid, id: unit.id, step: n }).unwrap(); dirtyRef.current = false; }
    catch (err) { dirtyRef.current = false; setValue(String(unit.step)); onError(errorMessage(err)); }
    finally { savingRef.current = false; }
  };

  return (
    <input
      className="input w-20"
      type="number"
      inputMode="decimal"
      step={0.01}
      min={0.01}
      aria-label={`Step for ${unit.name}`}
      value={value}
      onChange={(e) => { dirtyRef.current = true; setValue(e.target.value); }}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => {
        focusedRef.current = false;
        // Idle (never hand-edited): track server truth instead of firing a no-op save, which
        // matters if a background refetch changed unit.step while this field was focused.
        if (!dirtyRef.current) { setValue(String(unit.step)); return; }
        void save();
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

const threeDp = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
const isValidMinStock = (n: number) => Number.isFinite(n) && n >= 0 && threeDp(n);

/** Inline minimum editor for a group, mirroring UnitStepEditor's hydrate/dirty/save pattern. */
function GroupMinEditor({ hid, group, onError }: { hid: string; group: { id: string; minStock: number }; onError(msg: string): void }) {
  const [updateGroup] = useUpdateGroupMutation();
  const [value, setValue] = useState(String(group.minStock));
  const hydratedFor = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const focusedRef = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (hydratedFor.current !== group.id) {
      hydratedFor.current = group.id;
      dirtyRef.current = false;
      setValue(String(group.minStock));
      return;
    }
    if (!focusedRef.current && !dirtyRef.current) setValue(String(group.minStock));
  }, [group.id, group.minStock]);

  const save = async () => {
    if (savingRef.current || !dirtyRef.current) return;
    const n = Number(value);
    if (!isValidMinStock(n)) {
      dirtyRef.current = false;
      setValue(String(group.minStock));
      onError('Minimum must be 0 or more, with at most 3 decimal places');
      return;
    }
    if (n === group.minStock) { dirtyRef.current = false; return; }
    savingRef.current = true;
    try { await updateGroup({ hid, id: group.id, minStock: n }).unwrap(); dirtyRef.current = false; }
    catch (err) { dirtyRef.current = false; setValue(String(group.minStock)); onError(errorMessage(err)); }
    finally { savingRef.current = false; }
  };

  return (
    <input
      className="input w-20"
      type="number"
      inputMode="decimal"
      step={0.001}
      min={0}
      aria-label={`Minimum for ${group.id}`}
      value={value}
      onChange={(e) => { dirtyRef.current = true; setValue(e.target.value); }}
      onFocus={() => { focusedRef.current = true; }}
      onBlur={() => {
        focusedRef.current = false;
        if (!dirtyRef.current) { setValue(String(group.minStock)); return; }
        void save();
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
    />
  );
}

export function Settings() {
  const { hid = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { data: me } = useGetMeQuery();
  const household = me?.households.find((h) => h.id === hid);
  const isOwner = household?.role === 'owner';
  const run = async (fn: () => Promise<unknown>, ok?: string) => { try { await fn(); if (ok) toast.show({ message: ok }); } catch (err) { toast.show({ message: errorMessage(err) }); } };
  // Guards a subset of actions (create-store/unit, invite, feedback) against a double-tap firing
  // the mutation twice before the first response re-renders the disabled button — same pattern as
  // the shopping-list purchase guard (a ref, since `isLoading` only updates on the next render).
  const busyRef = useRef<Set<string>>(new Set());
  const guardedRun = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    try { await run(fn, ok); } finally { busyRef.current.delete(key); }
  };

  // --- household + members
  const { data: members } = useGetMembersQuery(hid);
  const [rename] = useRenameHouseholdMutation(); const [setRole] = useSetMemberRoleMutation(); const [removeMember] = useRemoveMemberMutation();
  const [leave] = useLeaveHouseholdMutation(); const [createInvite, createInviteState] = useCreateInviteMutation();
  const [name, setName] = useState('');
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!household || hydratedFor.current === household.id) return;
    hydratedFor.current = household.id;
    setName(household.name);
  }, [household]);
  const [inviteUrl, setInviteUrl] = useState('');

  // --- stores, units, archived
  const { data: stores } = useGetStoresQuery(hid); const [createStore, createStoreState] = useCreateStoreMutation(); const [deleteStore] = useDeleteStoreMutation();
  const { data: units } = useGetUnitsQuery(hid); const [createUnit, createUnitState] = useCreateUnitMutation(); const [deleteUnit] = useDeleteUnitMutation();
  const { data: archived } = useGetArchivedItemsQuery(hid); const [unarchive] = useUnarchiveItemMutation();
  const [storeName, setStoreName] = useState(''); const [unitName, setUnitName] = useState(''); const [unitPlural, setUnitPlural] = useState(''); const [unitStep, setUnitStep] = useState('1');

  // --- groups
  const { data: groups } = useGetGroupsQuery(hid); const [createGroup, createGroupState] = useCreateGroupMutation(); const [deleteGroup] = useDeleteGroupMutation();
  const { data: inventory } = useGetInventoryQuery(hid);
  const [groupName, setGroupName] = useState(''); const [groupMin, setGroupMin] = useState('0'); const [groupStoreId, setGroupStoreId] = useState('');

  // --- notifications
  const { data: vapid } = useGetVapidKeyQuery(undefined, { skip: !me?.pushEnabled });
  const [pushSub] = usePushSubscribeMutation(); const [pushUnsub] = usePushUnsubscribeMutation();
  const [subscribed, setSubscribed] = useState(false);
  useEffect(() => { void currentSubscription().then((s) => setSubscribed(!!s)); }, []);

  // --- feedback
  const { data: feedback } = useGetMyFeedbackQuery(undefined, { skip: !me?.feedbackEnabled });
  const [sendFeedback, feedbackState] = useSendFeedbackMutation();
  const [feedbackText, setFeedbackText] = useState('');
  const [logout] = useLogoutMutation();

  return (
    <div className="space-y-4 p-4">
      <Section title="Household">
        {isOwner ? (
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => rename({ hid, name }).unwrap(), 'Renamed'); }}>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} aria-label="Household name" /><button className="btn-ghost">Rename</button>
          </form>
        ) : <p>{household?.name}</p>}
        <ul className="divide-y divide-slate-100">
          {members?.map((m) => (
            <li key={m.sub} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{m.name}{m.sub === me?.user.sub && ' (you)'}</span><span className="text-sm text-slate-500">{m.role}</span></span>
              {isOwner && m.sub !== me?.user.sub && (<>
                <button className="btn-ghost" onClick={() => run(() => setRole({ hid, sub: m.sub, role: m.role === 'owner' ? 'member' : 'owner' }).unwrap())}>{m.role === 'owner' ? 'Make member' : 'Make owner'}</button>
                <button className="btn-ghost text-red-700" onClick={() => { if (confirm(`Remove ${m.name}?`)) void run(() => removeMember({ hid, sub: m.sub }).unwrap()); }}>Remove</button>
              </>)}
            </li>
          ))}
        </ul>
        <button className="btn-primary w-full" disabled={createInviteState.isLoading} onClick={() => guardedRun('invite', async () => {
          const inv = await createInvite(hid).unwrap(); setInviteUrl(inv.url);
          if (navigator.share) await navigator.share({ title: `Join ${household?.name} on Plantry`, url: inv.url }).catch(() => undefined);
          else await navigator.clipboard.writeText(inv.url).catch(() => undefined);
        }, 'Invite link ready (valid 7 days, single use)')}>Invite someone</button>
        {inviteUrl && <input className="input text-sm" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} aria-label="Invite link" />}
        <button className="btn-ghost w-full text-red-700" onClick={() => { if (confirm('Leave this household?')) void run(async () => { await leave(hid).unwrap(); navigate('/'); }); }}>Leave household</button>
      </Section>

      <Section title="Stores">
        <ul className="divide-y divide-slate-100">{stores?.map((s) => (
          <li key={s.id} className="flex items-center justify-between py-1"><span>{s.name}</span>
            <button aria-label={`Delete ${s.name}`} className="min-h-11 min-w-11 text-slate-400" onClick={() => { if (confirm(`Delete ${s.name}? Items keep working and move to "Any store".`)) void run(() => deleteStore({ hid, id: s.id }).unwrap()); }}>✕</button></li>))}</ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void guardedRun('addStore', async () => { await createStore({ hid, name: storeName }).unwrap(); setStoreName(''); }); }}>
          <input className="input" placeholder="New store" value={storeName} onChange={(e) => setStoreName(e.target.value)} required maxLength={120} /><button className="btn-ghost" disabled={createStoreState.isLoading}>Add</button></form>
      </Section>

      <Section title="Custom units">
        <ul className="divide-y divide-slate-100">{units?.filter((u) => !u.global).map((u) => (
          <li key={u.id} className="flex items-center justify-between gap-2 py-1">
            <span className="min-w-0 flex-1 truncate">{u.name}{u.pluralName ? ` / ${u.pluralName}` : ''}</span>
            <label className="flex items-center gap-1 text-sm text-slate-500">step
              <UnitStepEditor hid={hid} unit={u} onError={(msg) => toast.show({ message: msg })} />
            </label>
            <button aria-label={`Delete ${u.name}`} className="min-h-11 min-w-11 text-slate-400" onClick={() => run(() => deleteUnit({ hid, id: u.id }).unwrap())}>✕</button>
          </li>))}</ul>
        <form className="flex flex-wrap gap-2" noValidate onSubmit={(e) => {
          e.preventDefault();
          if (!unitName.trim()) { toast.show({ message: 'Unit name is required' }); return; }
          let step: number | undefined;
          if (unitStep.trim() !== '') {
            const n = Number(unitStep);
            if (!isValidStep(n)) { toast.show({ message: 'Step must be a number of at least 0.01, with at most 2 decimal places' }); return; }
            step = n;
          }
          void guardedRun('addUnit', async () => {
            await createUnit({ hid, name: unitName, pluralName: unitPlural || null, ...(step !== undefined ? { step } : {}) }).unwrap();
            setUnitName(''); setUnitPlural(''); setUnitStep('1');
          });
        }}>
          <input className="input" placeholder="sleeve" value={unitName} onChange={(e) => setUnitName(e.target.value)} maxLength={40} aria-label="Unit name" />
          <input className="input" placeholder="sleeves" value={unitPlural} onChange={(e) => setUnitPlural(e.target.value)} maxLength={40} aria-label="Plural" />
          <input className="input w-20" type="number" inputMode="decimal" step={0.01} min={0.01} placeholder="1" value={unitStep} onChange={(e) => setUnitStep(e.target.value)} aria-label="Step" />
          <button className="btn-ghost" disabled={createUnitState.isLoading}>Add</button>
        </form>
        <p className="text-sm text-slate-500">Built-in units (each, oz, lb, can…) are always available.</p>
      </Section>

      <Section title="Groups">
        <p className="text-sm text-slate-500">A group shares one minimum and one reminder across its members — e.g. 3 kinds of cat treats where only one needs to be in stock.</p>
        <ul className="divide-y divide-slate-100">{groups?.map((g) => {
          const memberNames = g.memberIds.map((id) => inventory?.find((i) => i.id === id)?.name ?? '…');
          return (
            <li key={g.id} className="space-y-1 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{g.name}{g.low && <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">low</span>}</span>
                <label className="flex items-center gap-1 text-sm text-slate-500">min
                  <GroupMinEditor hid={hid} group={g} onError={(msg) => toast.show({ message: msg })} />
                </label>
                <button aria-label={`Delete ${g.name}`} className="min-h-11 min-w-11 text-slate-400"
                  onClick={() => { if (confirm(`Delete ${g.name}? Members are kept — they just leave the group.`)) void run(() => deleteGroup({ hid, id: g.id }).unwrap()); }}>✕</button>
              </div>
              <p className="text-sm text-slate-500">{memberNames.length === 0 ? 'No members yet' : memberNames.join(', ')}</p>
            </li>
          );
        })}</ul>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => {
          e.preventDefault();
          void guardedRun('addGroup', async () => {
            await createGroup({ hid, name: groupName, minStock: Number(groupMin) || 0, preferredStoreId: groupStoreId || null }).unwrap();
            setGroupName(''); setGroupMin('0'); setGroupStoreId('');
          });
        }}>
          <input className="input" placeholder="Cat treats" value={groupName} onChange={(e) => setGroupName(e.target.value)} required maxLength={120} aria-label="Group name" />
          <input className="input w-20" type="number" inputMode="decimal" step={0.001} min={0} placeholder="0" value={groupMin} onChange={(e) => setGroupMin(e.target.value)} aria-label="Minimum" />
          <select className="input w-28" value={groupStoreId} onChange={(e) => setGroupStoreId(e.target.value)} aria-label="Preferred store"><option value="">Any store</option>{stores?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button className="btn-ghost" disabled={createGroupState.isLoading}>Add</button>
        </form>
      </Section>

      <Section title="Archived items">
        {archived?.length === 0 && <p className="text-sm text-slate-500">Nothing archived.</p>}
        <ul className="divide-y divide-slate-100">{archived?.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-2 py-1"><Link className="min-w-0 flex-1 truncate underline" to={`/h/${hid}/items/${i.id}`}>{i.name}</Link>
            <button className="btn-ghost" onClick={() => run(() => unarchive({ hid, id: i.id }).unwrap(), 'Restored')}>Restore</button></li>))}</ul>
      </Section>

      <Section title="Low-stock notifications">
        {!me?.pushEnabled ? <p className="text-sm text-slate-500">Not configured on this server.</p>
          : !pushSupported() || needsIosInstall() ? (
            <p className="text-sm text-slate-600">{needsIosInstall()
              ? 'On iPhone/iPad, first add Plantry to your Home Screen (Share → Add to Home Screen), then open it from there to turn on notifications.'
              : 'This browser does not support push notifications.'}</p>)
          : (<button className={subscribed ? 'btn-ghost w-full' : 'btn-primary w-full'}
              // Turning ON needs the VAPID key; it arrives asynchronously, and without this guard
              // an early tap threw a TypeError that surfaced as "Something went wrong".
              disabled={!subscribed && !vapid?.publicKey}
              onClick={() => run(async () => {
              if (subscribed) {
                // Drop the browser subscription first, then tell the server — but keep local state
                // consistent regardless of whether the server call succeeds: once the browser
                // subscription is gone, `subscribed` must flip to false even if `pushUnsub` fails
                // (a failure still surfaces as a toast via the surrounding `run`).
                const endpoint = await unsubscribePush();
                try { if (endpoint) await pushUnsub({ endpoint }).unwrap(); } finally { setSubscribed(false); }
                return;
              }
              const key = vapid?.publicKey;
              if (!key) throw new Error('Notifications are not available right now — try again in a moment');
              const json = await subscribePush(key);
              await pushSub({ endpoint: json.endpoint!, keys: { p256dh: json.keys!['p256dh']!, auth: json.keys!['auth']! } }).unwrap();
              setSubscribed(true);
            }, subscribed ? 'Notifications off on this device' : 'Notifications on for this device')}>{subscribed ? 'Turn off on this device' : 'Turn on for this device'}</button>)}
        <p className="text-sm text-slate-500">One summary each morning, per household, when something is running low.</p>
      </Section>

      {me?.feedbackEnabled && (
        <Section title="Feedback">
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void guardedRun('feedback', async () => { await sendFeedback({ body: feedbackText, pageUrl: location.pathname }).unwrap(); setFeedbackText(''); }, 'Thanks — sent!'); }}>
            <textarea className="input min-h-24 py-2" placeholder="Something broken, confusing, or missing?" value={feedbackText} onChange={(e) => setFeedbackText(e.target.value)} required maxLength={4000} aria-label="Feedback" />
            <button className="btn-primary w-full" disabled={feedbackState.isLoading}>Send feedback</button>
          </form>
          {!!feedback?.length && <ul className="divide-y divide-slate-100 text-sm">{feedback.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 py-2"><span className="min-w-0 flex-1 truncate">{f.title}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${f.status === 'done' ? 'bg-green-100 text-green-800' : f.status === 'closed' ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-800'}`}>{f.status}</span></li>))}</ul>}
        </Section>
      )}

      <button className="btn-ghost w-full" onClick={() => run(async () => { const r = await logout().unwrap(); window.location.assign(r.endSessionUrl ?? '/'); })}>Sign out ({me?.user.name})</button>
    </div>
  );
}
