import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_DOC, fromAnomalies } from '../../lib/timelineEditor';
import { type PointerEditOptions, usePointerEdit } from './usePointerEdit';

// 600 units for 120 s: 5 units a second. The picture is drawn 1 for 1 unless a test says it is zoomed.
const axis = { left: 100, right: 700, maxS: 120 };
const doc = fromAnomalies([
  { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29, startAt: 10, duration: 20 },
]);

function Harness({ options, svgWidth = 800 }: { options: PointerEditOptions; svgWidth?: number }) {
  const { bind, dragging } = usePointerEdit(options);
  return (
    <svg
      data-testid="svg"
      ref={(svg) => {
        if (svg) svg.getBoundingClientRect = () => ({ width: svgWidth }) as DOMRect;
      }}
    >
      <rect data-testid="body" {...bind('a1', 'move')} />
      <rect data-testid="start" {...bind('a1', 'start')} />
      <rect data-testid="end" {...bind('a1', 'end')} />
      <text data-testid="dragging">{dragging ?? 'none'}</text>
    </svg>
  );
}

function options(over: Partial<PointerEditOptions> = {}): PointerEditOptions {
  return {
    axis,
    widthUnits: 800,
    getDoc: () => doc,
    select: vi.fn(),
    move: vi.fn(),
    resize: vi.fn(),
    restore: vi.fn(),
    ...over,
  };
}

const down = (id: string, clientX: number, extra: object = {}) =>
  fireEvent.pointerDown(screen.getByTestId(id), { pointerId: 1, button: 0, clientX, ...extra });
const moveTo = (id: string, clientX: number) =>
  fireEvent.pointerMove(screen.getByTestId(id), { pointerId: 1, clientX });
const up = (id: string) => fireEvent.pointerUp(screen.getByTestId(id), { pointerId: 1 });

describe('usePointerEdit', () => {
  it('selects the block when it is grabbed and moves it by what the pointer travelled', () => {
    const o = options();
    render(<Harness options={o} />);
    down('body', 300);
    expect(o.select).toHaveBeenCalledWith('a1');
    expect(screen.getByTestId('dragging').textContent).toBe('a1');

    moveTo('body', 400); // 100 units to the right = 20 s
    expect(o.move).toHaveBeenLastCalledWith('a1', 30);
    moveTo('body', 250); // 50 units to the left of where it was grabbed = −10 s
    expect(o.move).toHaveBeenLastCalledWith('a1', 0);

    up('body');
    expect(screen.getByTestId('dragging').textContent).toBe('none');
    expect(o.restore).not.toHaveBeenCalled();
  });

  it('stops a block at the edge of the window', () => {
    const o = options();
    render(<Harness options={o} />);
    down('body', 300);
    moveTo('body', 5000);
    expect(o.move).toHaveBeenLastCalledWith('a1', 100); // 120 s − 20 s of block
  });

  it('moves the end edge, and the start edge, as times in the window', () => {
    const o = options();
    render(<Harness options={o} />);
    down('end', 300);
    moveTo('end', 400); // the end was at 30 s: 20 s later
    expect(o.resize).toHaveBeenLastCalledWith('a1', 'end', 50);
    moveTo('end', 99999);
    expect(o.resize).toHaveBeenLastCalledWith('a1', 'end', 120);
    up('end');

    down('start', 300);
    moveTo('start', 250); // the start was at 10 s: 10 s earlier
    expect(o.resize).toHaveBeenLastCalledWith('a1', 'start', 0);
    moveTo('start', 350);
    expect(o.resize).toHaveBeenLastCalledWith('a1', 'start', 20);
  });

  it('puts the copy back when Escape is pressed, and stops listening to the pointer', () => {
    const o = options();
    render(<Harness options={o} />);
    down('body', 300);
    moveTo('body', 400);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(o.restore).toHaveBeenCalledWith(doc);
    expect(screen.getByTestId('dragging').textContent).toBe('none');
    const calls = vi.mocked(o.move).mock.calls.length;
    moveTo('body', 500);
    expect(vi.mocked(o.move).mock.calls.length).toBe(calls);
  });

  it('puts the copy back when the pointer is cancelled', () => {
    const o = options();
    render(<Harness options={o} />);
    down('body', 300);
    moveTo('body', 400);
    fireEvent.pointerCancel(screen.getByTestId('body'), { pointerId: 1 });
    expect(o.restore).toHaveBeenCalledWith(doc);
  });

  it('converts screen pixels into the picture’s units when the page is scaled', () => {
    const o = options();
    render(<Harness options={o} svgWidth={1600} />); // zoomed: 1 unit is 2 pixels
    down('body', 300);
    moveTo('body', 500); // 200 pixels = 100 units = 20 s
    expect(o.move).toHaveBeenLastCalledWith('a1', 30);
  });

  it('ignores a button that is not the main one, and another pointer than the one that grabbed', () => {
    const o = options();
    render(<Harness options={o} />);
    down('body', 300, { button: 2 });
    expect(o.select).not.toHaveBeenCalled();

    down('body', 300);
    fireEvent.pointerMove(screen.getByTestId('body'), { pointerId: 2, clientX: 900 });
    expect(o.move).not.toHaveBeenCalled();
    up('body');
  });

  it('ignores a block that is gone', () => {
    const o = options({ getDoc: () => EMPTY_DOC });
    render(<Harness options={o} />);
    down('body', 300);
    expect(o.select).not.toHaveBeenCalled();
    expect(screen.getByTestId('dragging').textContent).toBe('none');
  });

  it('ignores the pointer while there is no picture to measure it on', () => {
    const o = options({ axis: null });
    render(<Harness options={o} />);
    down('body', 300);
    expect(o.select).not.toHaveBeenCalled();
  });
});
