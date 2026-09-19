import { useRef, useState } from 'react';
import { PHOTO_MAX_EDGE, THUMB_MAX_EDGE, type ItemDto } from '@plantry/shared';
import { useGetMeQuery, usePhotoDeleteMutation, usePhotoFinalizeMutation, usePhotoUploadUrlMutation } from '../api';
import { errorMessage } from '../lib/format';
import { downscale } from '../lib/downscale';
import { useToast } from './Toast';

async function putJpeg(url: string, blob: Blob): Promise<void> {
  // Direct-to-MinIO presigned PUT: the one place the UI calls fetch itself. Content-Type must match what was signed.
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

export function PhotoPicker({ hid, item }: { hid: string; item: ItemDto }) {
  const { data: me } = useGetMeQuery();
  const [uploadUrl] = usePhotoUploadUrlMutation(); const [finalize] = usePhotoFinalizeMutation(); const [remove] = usePhotoDeleteMutation();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  if (!me?.photosEnabled) return null;

  const onFile = async (file: File | undefined) => {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const [full, thumb] = await Promise.all([downscale(file, PHOTO_MAX_EDGE), downscale(file, THUMB_MAX_EDGE, 0.75)]);
      const up = await uploadUrl({ hid, id: item.id, sizeBytes: full.size, thumbSizeBytes: thumb.size }).unwrap();
      await Promise.all([putJpeg(up.uploadUrl, full), putJpeg(up.thumbUploadUrl, thumb)]);
      await finalize({ hid, id: item.id, key: up.key }).unwrap();
    } catch (err) { toast.show({ message: err instanceof Error && !('data' in err) ? err.message : errorMessage(err) }); }
    finally { busyRef.current = false; setBusy(false); if (input.current) input.current.value = ''; }
  };

  const onRemove = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try { await remove({ hid, id: item.id }).unwrap(); }
    catch (err) { toast.show({ message: errorMessage(err) }); }
    finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button type="button" disabled={busy} onClick={() => input.current?.click()} aria-label={item.imageUrl ? 'Change photo' : 'Add photo'}
        className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-100 text-sm text-slate-500">
        {busy ? '…' : item.imageUrl ? <img src={item.imageUrl} alt={item.name} className="h-full w-full object-cover" /> : '+ Photo'}
      </button>
      {item.imageUrl && !busy && <button type="button" className="text-xs text-slate-500 underline" onClick={() => void onRemove()}>Remove</button>}
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
    </div>
  );
}
