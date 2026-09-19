import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global { interface Window { BarcodeDetector?: new (opts?: { formats?: string[] }) => Detector } }
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

export function Scanner({ open, onDetected, onClose }: { open: boolean; onDetected(code: string): void; onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let stopped = false; let stream: MediaStream | undefined; let raf = 0; let zxingStop: (() => void) | undefined; let torndown = false;
    const done = (code: string) => { if (!stopped) { stopped = true; onDetected(code); } };
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
      if (video.current) video.current.srcObject = null;
    };

    (async () => {
      try {
        if (window.BarcodeDetector) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
          if (!video.current) return;
          video.current.srcObject = stream; await video.current.play();
          const detector = new window.BarcodeDetector({ formats: FORMATS });
          const tick = async () => {
            if (stopped || !video.current) return;
            try { const hit = (await detector.detect(video.current))[0]; if (hit) return done(hit.rawValue); } catch { /* frame not ready */ }
            raf = requestAnimationFrame(() => void tick());
          };
          void tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser'); // lazy: keeps zxing out of the main bundle
          if (stopped || !video.current) return;
          const controls = await new BrowserMultiFormatReader().decodeFromVideoDevice(undefined, video.current, (result) => { if (result) done(result.getText()); });
          zxingStop = () => controls.stop();
          if (stopped) zxingStop();
        }
      } catch {
        teardown();
        setError('Camera unavailable — check the site permission, or type the barcode on the item form.');
      }
    })();

    return teardown;
  }, [open, onDetected]);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content className="fixed inset-x-4 top-[10%] z-50 mx-auto max-w-sm space-y-3 rounded-2xl bg-white p-4">
          <Dialog.Title className="font-semibold">Scan a barcode</Dialog.Title>
          {error ? <p className="text-sm text-red-700">{error}</p> : <video ref={video} className="aspect-[4/3] w-full rounded-lg bg-black object-cover" muted playsInline />}
          <button type="button" className="btn-ghost w-full" onClick={onClose}>Cancel</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
