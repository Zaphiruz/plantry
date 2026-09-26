import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scanner } from './Scanner';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('Scanner camera teardown', () => {
  it('stops the camera stream when a post-getUserMedia error occurs', async () => {
    const stop = vi.fn();
    const track = { stop };
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
    // BarcodeDetector construction throws — simulates a failure after the camera stream is already live.
    vi.stubGlobal('BarcodeDetector', class { constructor() { throw new Error('boom'); } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(<Scanner open onDetected={() => {}} onClose={() => {}} />);

    expect(await screen.findByText(/Camera unavailable/)).toBeInTheDocument();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops the camera as soon as a code is detected', async () => {
    const stop = vi.fn();
    const onDetected = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => [{ rawValue: '01234567' }]); });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(<Scanner open onDetected={onDetected} onClose={() => {}} />);

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('01234567'));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('clears a previous error when reopened, so the second open can scan', async () => {
    const stop = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
    vi.stubGlobal('BarcodeDetector', class { constructor() { throw new Error('boom'); } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const { rerender } = render(<Scanner open onDetected={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(/Camera unavailable/)).toBeInTheDocument();

    rerender(<Scanner open={false} onDetected={() => {}} onClose={() => {}} />);
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => []); });
    rerender(<Scanner open onDetected={() => {}} onClose={() => {}} />);

    await waitFor(() => expect(screen.queryByText(/Camera unavailable/)).not.toBeInTheDocument());
    expect(document.querySelector('video')).not.toBeNull();
  });

  it('never asks for the camera when the video element is not mounted', async () => {
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => []); });

    render(<Scanner open={false} onDetected={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(getUserMedia).not.toHaveBeenCalled());
  });

  it('offers a reload when the lazy scanner chunk is gone after an update', async () => {
    const reload = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn() } });
    vi.stubGlobal('location', { ...window.location, reload });
    // No BarcodeDetector → the zxing chunk is imported, and a stale SW makes that 404.
    vi.stubGlobal('BarcodeDetector', undefined);
    vi.doMock('@zxing/browser', () => { throw new Error('Failed to fetch dynamically imported module'); });

    render(<Scanner open onDetected={() => {}} onClose={() => {}} />);

    expect(await screen.findByText(/new version is available/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reload).toHaveBeenCalled();
    vi.doUnmock('@zxing/browser');
  });

  it('stops the camera stream if unmounted while getUserMedia is still pending', async () => {
    const stop = vi.fn();
    const track = { stop };
    const gum = deferred<{ getTracks(): { stop: () => void }[] }>();
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(() => gum.promise) } });
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => []); });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const { unmount } = render(<Scanner open onDetected={() => {}} onClose={() => {}} />);
    unmount();
    expect(stop).not.toHaveBeenCalled();

    gum.resolve({ getTracks: () => [track] });
    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });
});

describe('Scanner continuous mode', () => {
  it('stays open (camera not torn down) after a detection', async () => {
    const stop = vi.fn();
    const onDetected = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => [{ rawValue: 'A1' }]); });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(<Scanner open continuous onDetected={onDetected} onClose={() => {}} />);

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('A1'));
    expect(stop).not.toHaveBeenCalled();
    expect(document.querySelector('video')).not.toBeNull();
  });

  it('debounces the same code for a period so a held barcode does not fire repeatedly', async () => {
    const onDetected = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } });
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => [{ rawValue: 'A1' }]); });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(<Scanner open continuous onDetected={onDetected} onClose={() => {}} />);

    await waitFor(() => expect(onDetected).toHaveBeenCalledTimes(1));
    // Give the detection loop several more ticks; the same code must stay debounced.
    await new Promise((r) => setTimeout(r, 50));
    expect(onDetected).toHaveBeenCalledTimes(1);
  });

  it('ignores new detections while the previous onDetected promise is pending', async () => {
    // gate1 unblocks after the first hit; gate2 is never resolved, so once the second hit lands
    // the scanner is permanently "busy" again — this keeps the tick loop from running away
    // instead of racing an arbitrary real-time wait against however many ticks fire.
    const gate1 = deferred<void>();
    const gate2 = deferred<void>();
    const onDetected = vi.fn().mockImplementationOnce(() => gate1.promise).mockImplementation(() => gate2.promise);
    let call = 0;
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } });
    // Alternate codes so debounce-by-code alone would not explain a single call.
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => [{ rawValue: (call++ % 2 === 0) ? 'A1' : 'B2' }]); });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(<Scanner open continuous onDetected={onDetected} onClose={() => {}} />);

    await waitFor(() => expect(onDetected).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(onDetected).toHaveBeenCalledTimes(1); // still pending — B2 must be ignored too

    gate1.resolve();
    await waitFor(() => expect(onDetected).toHaveBeenCalledTimes(2));
    // Busy again (gate2 never resolves) — further ticks must not fire a third call.
    await new Promise((r) => setTimeout(r, 30));
    expect(onDetected).toHaveBeenCalledTimes(2);
  });

  it('still tears down the camera on close even in continuous mode', async () => {
    const stop = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => []); });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    const { rerender } = render(<Scanner open continuous onDetected={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector('video')).not.toBeNull());
    rerender(<Scanner open={false} continuous onDetected={() => {}} onClose={() => {}} />);

    await waitFor(() => expect(stop).toHaveBeenCalledTimes(1));
  });

  it('renders the status line when provided', async () => {
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) } });
    vi.stubGlobal('BarcodeDetector', class { detect = vi.fn(async () => []); });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);

    render(<Scanner open continuous status="Ready — scan the next item" onDetected={() => {}} onClose={() => {}} />);

    expect(await screen.findByText('Ready — scan the next item')).toBeInTheDocument();
  });
});
