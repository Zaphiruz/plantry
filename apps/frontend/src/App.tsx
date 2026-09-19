import { Route, Routes } from 'react-router-dom';
import { useGetMeQuery } from './api';
import { Layout } from './components/Layout';
import { HouseholdPicker } from './pages/HouseholdPicker';
import { Inventory } from './pages/Inventory';
import { InviteAccept } from './pages/InviteAccept';
import { ItemDetail } from './pages/ItemDetail';
import { ItemForm } from './pages/ItemForm';
import { Settings } from './pages/Settings';
import { Shopping } from './pages/Shopping';

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
        <Route path="shopping" element={<Shopping />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<HouseholdPicker />} />
    </Routes>
  );
}
