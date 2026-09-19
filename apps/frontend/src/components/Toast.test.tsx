import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './Toast';

function Trigger({ onUndo }: { onUndo: () => void }) {
  const toast = useToast();
  return <button onClick={() => toast.show({ message: 'Restocked 12', actionLabel: 'Undo', onAction: onUndo, durationMs: 5000 })}>go</button>;
}

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('runs the action once and dismisses', async () => {
    const onUndo = vi.fn();
    render(<ToastProvider><Trigger onUndo={onUndo} /></ToastProvider>);
    await userEvent.click(screen.getByText('go'));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Restocked 12')).toBeNull();
  });

  it('auto-dismisses after its duration', async () => {
    render(<ToastProvider><Trigger onUndo={() => {}} /></ToastProvider>);
    await userEvent.click(screen.getByText('go'));
    expect(screen.getByText('Restocked 12')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5100); });
    expect(screen.queryByText('Restocked 12')).toBeNull();
  });
});
