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
