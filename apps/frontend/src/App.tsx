import { Route, Routes } from 'react-router-dom';
import { useGetMeQuery } from './api';
import { Layout } from './components/Layout';
import { QueryError } from './components/QueryError';
import { HouseholdPicker } from './pages/HouseholdPicker';
import { Inventory } from './pages/Inventory';
import { InviteAccept } from './pages/InviteAccept';
import { ItemDetail } from './pages/ItemDetail';
import { ItemForm } from './pages/ItemForm';
import { Settings } from './pages/Settings';
import { Shopping } from './pages/Shopping';

export function App() {
  const { data: me, isLoading, isError, error, refetch } = useGetMeQuery();
  // A 401 redirects to the login inside baseQuery; anything else has to be shown.
  if (isError && !me) return <QueryError error={error} onRetry={() => void refetch()} />;
  if (isLoading || !me) return <p className="p-8 text-center text-slate-500">Loading…</p>;
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
