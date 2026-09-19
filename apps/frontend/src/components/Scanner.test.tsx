import { render, screen, waitFor } from '@testing-library/react';
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
