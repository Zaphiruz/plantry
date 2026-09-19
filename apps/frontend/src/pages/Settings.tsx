import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  useCreateInviteMutation, useCreateStoreMutation, useCreateUnitMutation, useDeleteStoreMutation, useDeleteUnitMutation, useGetArchivedItemsQuery,
  useGetMeQuery, useGetMembersQuery, useGetMyFeedbackQuery, useGetStoresQuery, useGetUnitsQuery, useGetVapidKeyQuery, useLeaveHouseholdMutation,
  useLogoutMutation, usePushSubscribeMutation, usePushUnsubscribeMutation, useRemoveMemberMutation, useRenameHouseholdMutation,
  useSendFeedbackMutation, useSetMemberRoleMutation, useUnarchiveItemMutation,
} from '../api';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/format';
import { currentSubscription, needsIosInstall, pushSupported, subscribePush, unsubscribePush } from '../lib/push';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="card space-y-3"><h2 className="font-semibold">{title}</h2>{children}</section>
);

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
  const [storeName, setStoreName] = useState(''); const [unitName, setUnitName] = useState(''); const [unitPlural, setUnitPlural] = useState('');

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
          <li key={u.id} className="flex items-center justify-between py-1"><span>{u.name}{u.pluralName ? ` / ${u.pluralName}` : ''}</span>
            <button aria-label={`Delete ${u.name}`} className="min-h-11 min-w-11 text-slate-400" onClick={() => run(() => deleteUnit({ hid, id: u.id }).unwrap())}>✕</button></li>))}</ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void guardedRun('addUnit', async () => { await createUnit({ hid, name: unitName, pluralName: unitPlural || null }).unwrap(); setUnitName(''); setUnitPlural(''); }); }}>
          <input className="input" placeholder="sleeve" value={unitName} onChange={(e) => setUnitName(e.target.value)} required maxLength={40} aria-label="Unit name" />
          <input className="input" placeholder="sleeves" value={unitPlural} onChange={(e) => setUnitPlural(e.target.value)} maxLength={40} aria-label="Plural" /><button className="btn-ghost" disabled={createUnitState.isLoading}>Add</button></form>
        <p className="text-sm text-slate-500">Built-in units (each, oz, lb, can…) are always available.</p>
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
          : (<button className={subscribed ? 'btn-ghost w-full' : 'btn-primary w-full'} onClick={() => run(async () => {
              if (subscribed) {
                // Drop the browser subscription first, then tell the server — but keep local state
                // consistent regardless of whether the server call succeeds: once the browser
                // subscription is gone, `subscribed` must flip to false even if `pushUnsub` fails
                // (a failure still surfaces as a toast via the surrounding `run`).
                const endpoint = await unsubscribePush();
                try { if (endpoint) await pushUnsub({ endpoint }).unwrap(); } finally { setSubscribed(false); }
                return;
              }
              const json = await subscribePush(vapid!.publicKey!);
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
