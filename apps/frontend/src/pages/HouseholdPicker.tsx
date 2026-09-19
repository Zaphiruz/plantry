import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateHouseholdMutation, useGetMeQuery } from '../api';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/format';

export function HouseholdPicker() {
  const { data: me } = useGetMeQuery();
  const [create, { isLoading }] = useCreateHouseholdMutation();
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  return (
    <div className="mx-auto max-w-md space-y-6 p-4">
      <h1 className="text-2xl font-bold text-green-900">Plantry</h1>
      <p className="text-slate-600">Hi {me?.user.name}. Pick a household:</p>
      <ul className="space-y-2">
        {me?.households.map((h) => (
          <li key={h.id}><Link className="card flex min-h-14 items-center justify-between" to={`/h/${h.id}`}><span className="font-medium">{h.name}</span><span className="text-sm text-slate-500">{h.role}</span></Link></li>
        ))}
        {me?.households.length === 0 && <li className="text-slate-500">You're not in any household yet.</li>}
      </ul>
      <form className="card space-y-2" onSubmit={async (e) => {
        e.preventDefault();
        try { const h = await create({ name }).unwrap(); navigate(`/h/${h.id}`); } catch (err) { toast.show({ message: errorMessage(err) }); }
      }}>
        <label className="label" htmlFor="hh-name">Create a household</label>
        <input id="hh-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Casa" required maxLength={120} />
        <button className="btn-primary w-full" disabled={isLoading}>Create</button>
      </form>
      <form className="card space-y-2" onSubmit={(e) => {
        e.preventDefault();
        const token = invite.trim().split('/invite/').pop();
        if (token) navigate(`/invite/${token}`);
      }}>
        <label className="label" htmlFor="invite">Have an invite link?</label>
        <input id="invite" className="input" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="Paste it here" />
        <button className="btn-ghost w-full">Join</button>
      </form>
    </div>
  );
}
