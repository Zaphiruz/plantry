import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QtyDialog } from './QtyDialog';

function renderDialog(open: boolean, initial: number, step = 1) {
  return render(
    <QtyDialog open={open} title="Correct count" initial={initial} step={step} unitLabel="units" onConfirm={vi.fn()} onClose={vi.fn()} />,
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
      <QtyDialog open title="Correct count" initial={4} step={1} unitLabel="units" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText('Quantity')).toHaveValue(12);
  });

  it('hydrates from `initial` on the next open transition', () => {
    const { rerender } = renderDialog(true, 5);
    rerender(
      <QtyDialog open={false} title="Correct count" initial={4} step={1} unitLabel="units" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    rerender(
      <QtyDialog open title="Correct count" initial={4} step={1} unitLabel="units" onConfirm={vi.fn()} onClose={vi.fn()} />,
    );
    expect(screen.getByLabelText('Quantity')).toHaveValue(4);
  });
});

describe('QtyDialog stepper buttons', () => {
  it('Decrease/Increase move the value by step (8 -> 16 -> 8)', async () => {
    renderDialog(true, 8, 8);
    const input = screen.getByLabelText('Quantity');
    await userEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(input).toHaveValue(16);
    await userEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(input).toHaveValue(8);
  });

  it('Decrease never goes below step for a positive-only dialog', async () => {
    renderDialog(true, 8, 8);
    const input = screen.getByLabelText('Quantity');
    await userEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(input).toHaveValue(8);
  });

  it('Decrease on a sub-step value stays put instead of jumping up to the step (2, step 8)', async () => {
    renderDialog(true, 2, 8);
    const input = screen.getByLabelText('Quantity');
    await userEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(input).toHaveValue(2);
    await userEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(input).toHaveValue(10);
  });

  it('ten increases at step 0.1 accumulate without float drift', async () => {
    renderDialog(true, 0.1, 0.1);
    const input = screen.getByLabelText('Quantity');
    for (let i = 0; i < 9; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Increase' }));
    }
    expect(input).toHaveValue(1);
  });

  it('stepper buttons are large enough to tap and type="button"', () => {
    renderDialog(true, 1, 1);
    const inc = screen.getByRole('button', { name: 'Increase' });
    const dec = screen.getByRole('button', { name: 'Decrease' });
    expect(inc).toHaveAttribute('type', 'button');
    expect(dec).toHaveAttribute('type', 'button');
  });
});

describe('QtyDialog manual validation (noValidate)', () => {
  it('accepts a typed off-step value (1.5 with step 1)', async () => {
    const onConfirm = vi.fn();
    render(<QtyDialog open title="Use" initial={1} step={1} unitLabel="units" onConfirm={onConfirm} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Quantity');
    await userEvent.clear(input);
    await userEvent.type(input, '1.5');
    await userEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onConfirm).toHaveBeenCalledWith(1.5);
  });

  it('rejects 0 and empty for a positive-only dialog', async () => {
    const onConfirm = vi.fn();
    render(<QtyDialog open title="Use" initial={1} step={1} unitLabel="units" onConfirm={onConfirm} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Quantity');
    await userEvent.clear(input);
    await userEvent.type(input, '0');
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
    await userEvent.clear(input);
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('shows an inline reason (role=alert) when the value is invalid', async () => {
    render(<QtyDialog open title="Use" initial={1} step={1} unitLabel="units" onConfirm={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Quantity');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.clear(input);
    expect(await screen.findByRole('alert')).toHaveTextContent(/./);
    await userEvent.type(input, '1.2345');
    expect(await screen.findByRole('alert')).toHaveTextContent(/decimal/i);
  });
});
