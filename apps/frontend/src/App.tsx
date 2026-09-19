import { Route, Routes } from 'react-router-dom';
import { useGetMeQuery } from './api';
import { Layout } from './components/Layout';
import { HouseholdPicker } from './pages/HouseholdPicker';
import { Inventory } from './pages/Inventory';
import { InviteAccept } from './pages/InviteAccept';
import { ItemDetail } from './pages/ItemDetail';
import { ItemForm } from './pages/ItemForm';

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
        <Route path="items/new" element={<ItemForm />} />
        <Route path="items/:id" element={<ItemDetail />} />
        <Route path="items/:id/edit" element={<ItemForm />} />
        <Route path="shopping" element={<Placeholder name="Shopping" />} />
        <Route path="settings" element={<Placeholder name="Settings" />} />
      </Route>
      <Route path="*" element={<HouseholdPicker />} />
    </Routes>
  );
}
