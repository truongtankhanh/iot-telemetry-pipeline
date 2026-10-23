import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../test-axe';
import { NumberField } from './NumberField';
import { parseNumber } from './parseNumber';
import { PercentField } from './PercentField';
import { ToggleChip } from './ToggleChip';

describe('parseNumber', () => {
  it('reads a number, a decimal comma and surrounding spaces; an empty field or text is null', () => {
    expect(parseNumber('5')).toBe(5);
    expect(parseNumber(' 2.5 ')).toBe(2.5);
    expect(parseNumber('2,5')).toBe(2.5);
    expect(parseNumber('-1')).toBe(-1);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('   ')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('2.')).toBe(2);
    expect(parseNumber('Infinity')).toBeNull();
  });
});

function Harness({
  initial = 5 as number | null,
  onCommit = () => {},
  error,
  disabled,
}: {
  initial?: number | null;
  onCommit?: (value: number | null) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <NumberField
      label="Delay"
      unit="ms"
      value={value}
      onChange={setValue}
      onCommit={onCommit}
      error={error}
      disabled={disabled}
    />
  );
}

describe('NumberField', () => {
  it('shows the value in force at rest, with its unit, under its label', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Delay')).toHaveValue('5');
    expect(screen.getByText('ms')).toBeInTheDocument();
  });

  it('shows an empty field for no value', () => {
    render(<Harness initial={null} />);
    expect(screen.getByLabelText('Delay')).toHaveValue('');
  });

  it('shows what was typed while it has focus, then the value again at rest', async () => {
    const user = userEvent.setup();
    render(<Harness initial={5} />);
    const field = screen.getByLabelText('Delay');
    await user.click(field);
    await user.clear(field);
    await user.type(field, '2.');
    expect(field).toHaveValue('2.');
    await user.tab();
    expect(field).toHaveValue('2');
  });

  it('tells the page the number, and null for an empty field or text that is not one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<NumberField label="Delay" value={5} onChange={onChange} />);
    const field = screen.getByLabelText('Delay');
    await user.click(field);
    await user.clear(field);
    expect(onChange).toHaveBeenLastCalledWith(null);
    await user.type(field, '42');
    expect(onChange).toHaveBeenLastCalledWith(42);
    await user.type(field, 'x');
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('commits the value when it loses focus and when Enter is pressed', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Harness initial={5} onCommit={onCommit} />);
    const field = screen.getByLabelText('Delay');
    await user.click(field);
    await user.clear(field);
    await user.type(field, '8{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith(8);
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenLastCalledWith(8);
  });

  it('drops what was typed when the value in force changes to something else, so a blur does not send it again', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const { rerender } = render(
      <NumberField label="Delay" value={5} onChange={() => {}} onCommit={onCommit} />,
    );
    const field = screen.getByLabelText('Delay');
    await user.click(field);
    await user.clear(field);
    await user.type(field, '8');
    // The page turned 8 down and puts 5 back while the field still has focus.
    rerender(<NumberField label="Delay" value={6} onChange={() => {}} onCommit={onCommit} />);
    rerender(<NumberField label="Delay" value={5} onChange={() => {}} onCommit={onCommit} />);
    expect(field).toHaveValue('5');
    await user.tab();
    expect(onCommit).toHaveBeenLastCalledWith(5);
  });

  it('keeps the text while the value follows what is typed', async () => {
    const user = userEvent.setup();
    render(<Harness initial={5} />);
    const field = screen.getByLabelText('Delay');
    await user.click(field);
    await user.clear(field);
    await user.type(field, '12.');
    expect(field).toHaveValue('12.');
  });

  it('says an error in words, under the field, announced and tied to it', () => {
    render(<Harness error="The delay is from 1 to 10,000 ms" />);
    const field = screen.getByLabelText('Delay');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('The delay is from 1 to 10,000 ms');
    expect(field).toHaveAccessibleDescription('The delay is from 1 to 10,000 ms');
  });

  it('has no error mark without an error, and can be disabled', () => {
    render(<Harness disabled />);
    const field = screen.getByLabelText('Delay');
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(field).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

function PercentHarness({
  onCommit = () => {},
  initial = 5 as number | null,
}: {
  onCommit?: (value: number | null) => void;
  initial?: number | null;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <PercentField
      label="Drop messages"
      value={value}
      onChange={setValue}
      onCommit={onCommit}
      trackMax={20}
    />
  );
}

describe('PercentField', () => {
  it('has a slider and a number, each named by what they are a share of', () => {
    render(<PercentHarness />);
    const slider = screen.getByRole('slider', { name: 'Drop messages slider' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '20');
    expect(slider).toHaveValue('5');
    expect(screen.getByLabelText('Drop messages (percent)')).toHaveValue('5');
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('follows a drag at once and commits when the pointer is released, not on every step', () => {
    const onCommit = vi.fn();
    render(<PercentHarness onCommit={onCommit} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '8' } });
    fireEvent.change(slider, { target: { value: '9.5' } });
    expect(screen.getByLabelText('Drop messages (percent)')).toHaveValue('9.5');
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(9.5);
  });

  it('commits when an arrow key, Home or End is released, and not for another key', () => {
    const onCommit = vi.fn();
    render(<PercentHarness onCommit={onCommit} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '6' } });
    fireEvent.keyUp(slider, { key: 'Tab' });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyUp(slider, { key: 'ArrowRight' });
    expect(onCommit).toHaveBeenCalledWith(6);
    fireEvent.keyUp(slider, { key: 'End' });
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('takes a number beyond the track, and the slider rests at its end', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<PercentHarness onCommit={onCommit} />);
    const number = screen.getByLabelText('Drop messages (percent)');
    await user.click(number);
    await user.clear(number);
    await user.type(number, '50{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith(50);
    expect(screen.getByRole('slider')).toHaveValue('20');
    expect(number).toHaveValue('50');
  });

  it('rests the slider at 0 for an empty number, and shows the error under the number', () => {
    const { rerender } = render(
      <PercentField
        label="Drop"
        value={null}
        onChange={() => {}}
        onCommit={() => {}}
        trackMax={20}
      />,
    );
    expect(screen.getByRole('slider')).toHaveValue('0');
    rerender(
      <PercentField
        label="Drop"
        value={null}
        onChange={() => {}}
        onCommit={() => {}}
        trackMax={20}
        error="Enter a percentage"
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a percentage');
  });

  it('disables both controls together', () => {
    render(
      <PercentField
        label="Drop"
        value={5}
        onChange={() => {}}
        onCommit={() => {}}
        trackMax={20}
        disabled
      />,
    );
    expect(screen.getByRole('slider')).toBeDisabled();
    expect(screen.getByLabelText('Drop (percent)')).toBeDisabled();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<PercentHarness />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('ToggleChip', () => {
  it('is a button that says whether it is pressed', () => {
    const { rerender } = render(
      <ToggleChip pressed={false} onChange={() => {}}>
        range
      </ToggleChip>,
    );
    const chip = screen.getByRole('button', { name: 'range' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    rerender(
      <ToggleChip pressed onChange={() => {}}>
        range
      </ToggleChip>,
    );
    expect(screen.getByRole('button', { name: 'range' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('asks for the opposite on a click, on Space and on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToggleChip pressed={false} onChange={onChange}>
        json
      </ToggleChip>,
    );
    await user.click(screen.getByRole('button'));
    expect(onChange).toHaveBeenLastCalledWith(true);
    screen.getByRole('button').focus();
    await user.keyboard(' ');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('says what it is in its title and does nothing when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToggleChip
        pressed={false}
        onChange={onChange}
        title="A body that is not valid JSON"
        disabled
      >
        json
      </ToggleChip>,
    );
    const chip = screen.getByRole('button', { name: 'json' });
    expect(chip).toHaveAttribute('title', 'A body that is not valid JSON');
    await user.click(chip);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has no accessibility violations in a group', async () => {
    const { container } = render(
      <div role="group" aria-label="Malformed kinds">
        <ToggleChip pressed onChange={() => {}}>
          range
        </ToggleChip>
        <ToggleChip pressed={false} onChange={() => {}}>
          json
        </ToggleChip>
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
