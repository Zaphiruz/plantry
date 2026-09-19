import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLongPress } from './useLongPress';

function Button({ onLongPress, onClick }: { onLongPress(): void; onClick(): void }) {
  const handlers = useLongPress(onLongPress, onClick);
  return <button {...handlers}>press</button>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useLongPress', () => {
  it('tap (down, up before 500ms) fires onClick once and never onLongPress', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { getByText } = render(<Button onLongPress={onLongPress} onClick={onClick} />);
    const btn = getByText('press');
    fireEvent.pointerDown(btn);
    vi.advanceTimersByTime(100);
    fireEvent.pointerUp(btn);
    vi.advanceTimersByTime(600);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('hold (down, advance 500ms, up) fires onLongPress once and never onClick', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { getByText } = render(<Button onLongPress={onLongPress} onClick={onClick} />);
    const btn = getByText('press');
    fireEvent.pointerDown(btn);
    vi.advanceTimersByTime(500);
    fireEvent.pointerUp(btn);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('down, pointerCancel, advance 600ms → neither fires', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { getByText } = render(<Button onLongPress={onLongPress} onClick={onClick} />);
    const btn = getByText('press');
    fireEvent.pointerDown(btn);
    fireEvent.pointerCancel(btn);
    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('down, pointerLeave, advance 600ms, up → neither fires', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { getByText } = render(<Button onLongPress={onLongPress} onClick={onClick} />);
    const btn = getByText('press');
    fireEvent.pointerDown(btn);
    fireEvent.pointerLeave(btn);
    vi.advanceTimersByTime(600);
    fireEvent.pointerUp(btn);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('down, unmount, advance 600ms → onLongPress never fires', () => {
    const onLongPress = vi.fn();
    const onClick = vi.fn();
    const { getByText, unmount } = render(<Button onLongPress={onLongPress} onClick={onClick} />);
    const btn = getByText('press');
    fireEvent.pointerDown(btn);
    unmount();
    vi.advanceTimersByTime(600);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
