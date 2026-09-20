import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QtyDialog } from './QtyDialog';

function renderDialog(open: boolean, initial: number) {
  return render(
    <QtyDialog open={open} title="Correct count" initial={initial} unitLabel="units" onConfirm={vi.fn()} onClose={vi.fn()} />,
  );
}

describe('QtyDialog re-hydration', () => {
  it('does not overwrite a typed value when `initial` changes while open (e.g. a background refetch)', async () => {
    const { rerender } = renderDialog(true, 5);
    const input = screen.getByLabelText('Quantity');
    expect(input).toHaveValue(5);

    await userEvent.clear(input);
    await userEvent.type(input, '12');
    expect(input).toHaveValue(12);

    // Background refetch lands while the dialog is still open with a different `initial`.
    rerender(
      <QtyDialog open title="Correct count" initial={4} unitLabel="units" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText('Quantity')).toHaveValue(12);
  });

  it('hydrates from `initial` on the next open transition', () => {
    const { rerender } = renderDialog(true, 5);
    rerender(
      <QtyDialog open={false} title="Correct count" initial={4} unitLabel="units" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    rerender(
      <QtyDialog open title="Correct count" initial={4} unitLabel="units" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText('Quantity')).toHaveValue(4);
  });
});
