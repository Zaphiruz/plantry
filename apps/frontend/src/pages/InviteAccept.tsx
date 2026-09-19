import { useEffect, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAcceptInviteMutation } from '../api';
import { errorMessage } from '../lib/format';

export function InviteAccept() {
  const { token = '' } = useParams();
  const [accept, { error }] = useAcceptInviteMutation();
  const navigate = useNavigate();
  const started = useRef(false); // StrictMode double-invokes effects; the endpoint is idempotent but don't race it
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    accept(token).unwrap().then((h) => navigate(`/h/${h.id}`, { replace: true })).catch(() => {});
  }, [accept, navigate, token]);
  if (!error) return <p className="p-8 text-center text-slate-500">Joining…</p>;
  return <div className="space-y-4 p-8 text-center"><p>{errorMessage(error)}</p><Link className="btn-ghost" to="/">Back</Link></div>;
}
