import { errorMessage } from '../lib/format';

/** Terminal state for a failed query: what went wrong, plus a way out. */
export function QueryError({ error, onRetry, children }: { error: unknown; onRetry?: () => void; children?: React.ReactNode }) {
  return (
    <div role="alert" className="space-y-3 p-8 text-center">
      <p className="text-slate-700">{errorMessage(error)}</p>
      {onRetry && <button type="button" className="btn-ghost" onClick={onRetry}>Try again</button>}
      {children}
    </div>
  );
}
