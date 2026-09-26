import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useNavigate, useParams } from 'react-router-dom';
import { useGetGroupsQuery, useGetInventoryQuery, useGetMeQuery } from '../api';

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export function Layout() {
  const { hid = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const { data: me, isFetching: meFetching } = useGetMeQuery();
  const { data: items } = useGetInventoryQuery(hid);
  const { data: groups } = useGetGroupsQuery(hid);
  // Don't redirect while `me` is being refetched (e.g. right after creating/joining a
  // household invalidates the "Me" tag) — the cached list is briefly stale and would
  // otherwise bounce the user straight back to "/" before the new household appears.
  if (me && !meFetching && !me.households.some((h) => h.id === hid)) return <Navigate to="/" replace />;
  // Brief C: the Shopping badge counts nagging (ungrouped) items plus low groups — a grouped
  // item never nags on its own, so without the group term a low group would go uncounted here.
  const lowCount = (items?.filter((i) => i.nagging).length ?? 0) + (groups?.filter((g) => g.low).length ?? 0);
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex min-h-14 flex-1 items-center justify-center gap-1 text-sm font-medium ${isActive ? 'text-green-800' : 'text-slate-500'}`;

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
        <span className="font-bold text-green-900">Plantry</span>
        <select aria-label="Household" className="input ml-auto max-w-[60%]" value={hid}
          onChange={(e) => navigate(e.target.value === '__all' ? '/' : `/h/${e.target.value}`)}>
          {me?.households.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          <option value="__all">All households…</option>
        </select>
      </header>
      {!online && <div role="alert" className="bg-amber-100 px-3 py-2 text-center text-sm text-amber-900">You're offline — changes are disabled until you reconnect.</div>}
      <main className="flex-1 pb-20">
        <fieldset disabled={!online}><Outlet /></fieldset>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-2xl border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <NavLink to={`/h/${hid}`} end className={tab}>Inventory</NavLink>
        <NavLink to={`/h/${hid}/shopping`} className={tab}>
          Shopping{lowCount > 0 && <span className="rounded-full bg-red-600 px-2 text-xs text-white">{lowCount}</span>}
        </NavLink>
        <NavLink to={`/h/${hid}/settings`} className={tab}>Settings</NavLink>
      </nav>
    </div>
  );
}
