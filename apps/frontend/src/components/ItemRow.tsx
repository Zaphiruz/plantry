import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { ItemDto } from '@plantry/shared';
import { useAddToListMutation, useConsumeMutation, useGetGroupsQuery, useRemoveListRowMutation, useRestockMutation, useUndoEventMutation } from '../api';
import { errorMessage, formatQty } from '../lib/format';
import { useLongPress } from '../lib/useLongPress';
import { QtyDialog } from './QtyDialog';
import { useToast } from './Toast';

export function ItemRow({ hid, item }: { hid: string; item: ItemDto }) {
  const [consume] = useConsumeMutation();
  const [restock] = useRestockMutation();
  const [undo] = useUndoEventMutation();
  const [addToList] = useAddToListMutation();
  const [removeRow] = useRemoveListRowMutation();
  const [dialog, setDialog] = useState<null | 'consume' | 'restock'>(null);
  const toast = useToast();
  const unitLabel = item.unit.abbreviation ?? item.unit.pluralName ?? item.unit.name;
  const { data: groups } = useGetGroupsQuery(hid);
  const group = item.groupId ? groups?.find((g) => g.id === item.groupId) : undefined;

  const act = async (kind: 'consume' | 'restock', quantity: number) => {
    try {
      const r = await (kind === 'consume' ? consume : restock)({ hid, itemId: item.id, quantity }).unwrap();
      const eventId = r.eventId;
      toast.show({
        message: `${kind === 'consume' ? 'Used' : 'Added'} ${formatQty(quantity, item.unit)} · ${item.name}`,
        ...(eventId ? { actionLabel: 'Undo', onAction: () => { undo({ hid, eventId }).unwrap().catch((err) => toast.show({ message: errorMessage(err) })); } } : {}),
        durationMs: 6000,
      });
    } catch (err) { toast.show({ message: errorMessage(err) }); }
  };
  const step = item.unit.step;
  const minus = useLongPress(() => setDialog('consume'), () => void act('consume', step));
  const plus = useLongPress(() => setDialog('restock'), () => void act('restock', step));
  const toggleTrip = async () => {
    try {
      if (item.nextTripRowId) await removeRow({ hid, id: item.nextTripRowId }).unwrap();
      else await addToList({ hid, body: { itemId: item.id } }).unwrap();
    } catch (err) { toast.show({ message: errorMessage(err) }); }
  };

  return (
    <li className="flex items-center gap-2 border-b border-slate-100 bg-white px-3 py-2">
      <Link to={`/h/${hid}/items/${item.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        {item.thumbUrl
          ? <img src={item.thumbUrl} alt="" className="h-11 w-11 rounded-lg object-cover" loading="lazy" />
          : <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-400">{item.name[0]?.toUpperCase()}</span>}
        <span className="min-w-0">
          <span className="block truncate font-medium">{item.name}</span>
          <span className={`text-sm ${item.nagging ? 'font-semibold text-red-700' : 'text-slate-500'}`}>
            {formatQty(item.currentCount, item.unit)}{item.nagging && ' · low'}
          </span>
          {group && <span className="block w-fit rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">in {group.name}</span>}
        </span>
      </Link>
      <button type="button" aria-label={item.nextTripRowId ? `Remove ${item.name} from next trip` : `Add ${item.name} to next trip`} aria-pressed={!!item.nextTripRowId}
        className={`min-h-11 min-w-11 rounded-lg text-xl ${item.nextTripRowId ? 'bg-green-100 text-green-800' : 'text-slate-400'}`} onClick={toggleTrip}>🛒</button>
      <button type="button" aria-label={`Use ${formatQty(step, item.unit)} ${item.name}`} className="btn-ghost min-w-11 touch-manipulation px-0 text-xl" {...minus}>−</button>
      <button type="button" aria-label={`Add ${formatQty(step, item.unit)} ${item.name}`} className="btn-ghost min-w-11 touch-manipulation px-0 text-xl" {...plus}>+</button>
      <QtyDialog open={dialog !== null} title={dialog === 'consume' ? `Use ${item.name}` : `Restock ${item.name}`}
        initial={dialog === 'restock' ? item.defaultRestockQty : step} step={step} unitLabel={unitLabel}
        onConfirm={(n) => dialog && void act(dialog, n)} onClose={() => setDialog(null)} />
    </li>
  );
}
