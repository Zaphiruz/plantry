import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (opts?: { formats?: string[] }) => Detector } }
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export function Scanner({ open, onDetected, onClose }: { open: boolean; onDetected(code: string): void; onClose(): void }) {
  // The <video> lives inside a Radix portal that mounts after this component commits, so the
  // element arrives via state (a callback ref) rather than a plain ref: the effect below must
  // not start until there is somewhere to put the camera stream.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);

  // Reset during render (not in an effect) so the first committed render of a reopened scanner
  // already shows the <video>; otherwise the effect below would find `video.current === null`
  // and bail, leaving the scanner permanently dead after one camera failure.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) { setError(''); setStale(false); }
  }

  useEffect(() => {
    // Never acquire a camera we have nowhere to show (and would have to release again).
    if (!open || !video) return;
    let stopped = false; let stream: MediaStream | undefined; let raf = 0; let zxingStop: (() => void) | undefined; let torndown = false;
    // Stops every open resource (camera track, rAF loop, zxing controls) regardless of which exit path
    // triggered it (detected, cancel/unmount cleanup, or an error caught after getUserMedia resolved).
    // Idempotent: safe to call from both the catch block and the effect cleanup.
    const teardown = () => {
      if (torndown) return;
      torndown = true;
      stopped = true;
      cancelAnimationFrame(raf);
      zxingStop?.();
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
    const done = (code: string) => {
      if (stopped) return;
      teardown(); // release the camera immediately, before the caller re-renders
      onDetected(code);
    };

    (async () => {
      try {
        if (window.BarcodeDetector) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
          video.srcObject = stream; await video.play();
          const detector = new window.BarcodeDetector({ formats: FORMATS });
          const tick = async () => {
            if (stopped) return;
            try { const hit = (await detector.detect(video))[0]; if (hit) return done(hit.rawValue); } catch { /* frame not ready */ }
            raf = requestAnimationFrame(() => void tick());
          };
          void tick();
        } else {
          // Lazy: keeps zxing out of the main bundle. A new service worker that took over an open
          // document can leave this hashed chunk 404ing — that is NOT a camera problem, so it gets
          // its own message instead of a misleading "Camera unavailable".
          let BrowserMultiFormatReader;
          try { ({ BrowserMultiFormatReader } = await import('@zxing/browser')); }
          catch { teardown(); setStale(true); return; }
          if (stopped) return;
          const controls = await new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video, (result) => { if (result) done(result.getText()); });
          zxingStop = () => controls.stop();
          if (stopped) zxingStop();
        }
      } catch {
        teardown();
        setError('Camera unavailable — check the site permission, or type the barcode on the item form.');
      }
    })();

    return teardown;
  }, [open, video, onDetected]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content className="fixed inset-x-4 top-[10%] z-50 mx-auto max-w-sm space-y-3 rounded-2xl bg-white p-4">
          <Dialog.Title className="font-semibold">Scan a barcode</Dialog.Title>
          <Dialog.Description className="sr-only">Point the camera at the barcode on the item.</Dialog.Description>
          {stale ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-700">A new version is available — reload to keep scanning.</p>
              <button type="button" className="btn-primary w-full" onClick={() => location.reload()}>Reload</button>
            </div>
          ) : error ? <p className="text-sm text-red-700">{error}</p>
            : <video ref={setVideo} className="aspect-[4/3] w-full rounded-lg bg-black object-cover" muted playsInline />}
          <button type="button" className="btn-ghost w-full" onClick={onClose}>Cancel</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
