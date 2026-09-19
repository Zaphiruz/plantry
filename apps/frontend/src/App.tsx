import { Route, Routes } from 'react-router-dom';
import { useGetMeQuery } from './api';
import { Layout } from './components/Layout';
import { HouseholdPicker } from './pages/HouseholdPicker';
import { Inventory } from './pages/Inventory';
import { InviteAccept } from './pages/InviteAccept';

const Placeholder = ({ name }: { name: string }) => <p className="p-4 text-slate-500">{name} — coming in a later task</p>;

export function App() {
  const { data: me, isLoading } = useGetMeQuery();
  if (isLoading || !me) return <p className="p-8 text-center text-slate-500">Loading…</p>; // a 401 redirects inside baseQuery
  return (
    <Routes>
      <Route path="/" element={<HouseholdPicker />} />
      <Route path="/invite/:token" element={<InviteAccept />} />
      <Route path="/h/:hid" element={<Layout />}>
        <Route index element={<Inventory />} />
        <Route path="items/new" element={<Placeholder name="New item" />} />
        <Route path="items/:id" element={<Placeholder name="Item" />} />
        <Route path="items/:id/edit" element={<Placeholder name="Edit item" />} />
        <Route path="shopping" element={<Placeholder name="Shopping" />} />
        <Route path="settings" element={<Placeholder name="Settings" />} />
      </Route>
      <Route path="*" element={<HouseholdPicker />} />
    </Routes>
  );
}
