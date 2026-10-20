import { act, render, renderHook, screen } from '@testing-library/react';
import { type ReactNode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublishedMessage } from '../api/types';
import { HistoryStore } from './history';
import { useDeviceLatest, useSeries } from './historyContext';
import { StudioProvider } from './StudioProvider';
import { createStudioStore } from './store';
import { useNow } from './useNow';

const T0 = Date.parse('2026-10-20T09:00:00.000Z');

const message = (deviceId: string, atS: number, value: number): PublishedMessage => {
  const ts = new Date(T0 + atS * 1000).toISOString();
  return {
    deviceId,
    topic: `campus/BLD-DC/${deviceId}/telemetry`,
    payload: JSON.stringify({ seq: atS, ts, metrics: { temperature_c: value } }),
    seq: atS,
    ts,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

function wrapperFor(history: HistoryStore) {
  const store = createStudioStore();
  return ({ children }: { children: ReactNode }) => (
    <StudioProvider store={store} history={history}>
      {children}
    </StudioProvider>
  );
}

/** Reports each commit to `onRender`, so a test can tell "renders again" from "does not". */
function Reader({ deviceId, onRender }: { deviceId: string; onRender: () => void }) {
  const series = useSeries(deviceId, 'temperature_c');
  useEffect(() => {
    onRender();
  });
  return <p data-testid={deviceId}>{series.map((s) => s.v).join(',')}</p>;
}

describe('useSeries', () => {
  it('shows the series, and renders again when that series has news, not when another does', () => {
    const history = new HistoryStore();
    const Wrapper = wrapperFor(history);
    const renderedA = vi.fn();
    const renderedB = vi.fn();
    render(
      <Wrapper>
        <Reader deviceId="a" onRender={renderedA} />
        <Reader deviceId="b" onRender={renderedB} />
      </Wrapper>,
    );
    expect(renderedA).toHaveBeenCalledTimes(1);
    expect(renderedB).toHaveBeenCalledTimes(1);

    act(() => {
      history.record(message('a', 0, 22.5));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('a')).toHaveTextContent('22.5');
    expect(renderedA).toHaveBeenCalledTimes(2);
    expect(renderedB).toHaveBeenCalledTimes(1);
  });

  it('renders once per notification however many messages arrived', () => {
    const history = new HistoryStore();
    const Wrapper = wrapperFor(history);
    const rendered = vi.fn();
    render(
      <Wrapper>
        <Reader deviceId="a" onRender={rendered} />
      </Wrapper>,
    );
    act(() => {
      for (let i = 0; i < 20; i++) history.record(message('a', i, i));
      vi.advanceTimersByTime(1000);
    });
    expect(rendered).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('a')).toHaveTextContent('0,1,2');
  });

  it('follows a device and metric that change', () => {
    const history = new HistoryStore();
    history.seed([message('a', 0, 1), message('b', 0, 2)]);
    const { result, rerender } = renderHook(({ id }) => useSeries(id, 'temperature_c'), {
      initialProps: { id: 'a' },
      wrapper: wrapperFor(history),
    });
    expect(result.current.map((s) => s.v)).toEqual([1]);
    rerender({ id: 'b' });
    expect(result.current.map((s) => s.v)).toEqual([2]);
  });

  it('stops listening when the component is gone', () => {
    const history = new HistoryStore();
    const { unmount } = renderHook(() => useSeries('a', 'temperature_c'), {
      wrapper: wrapperFor(history),
    });
    unmount();
    expect(() => {
      history.record(message('a', 0, 1));
      vi.advanceTimersByTime(1000);
    }).not.toThrow();
  });

  it('needs a provider', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSeries('a', 'temperature_c'))).toThrow(/StudioProvider/);
    quiet.mockRestore();
  });
});

describe('useDeviceLatest', () => {
  it('gives the last message of the device once it is announced', () => {
    const history = new HistoryStore();
    const { result } = renderHook(() => useDeviceLatest('a'), { wrapper: wrapperFor(history) });
    expect(result.current).toEqual({ lastSeen: null, last: null });
    const latest = message('a', 4, 30);
    act(() => {
      history.record(latest);
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.lastSeen).toBe(T0 + 4000);
    expect(result.current.last).toEqual(latest);
  });
});

describe('StudioProvider', () => {
  it('creates a history of its own when none is given', () => {
    const store = createStudioStore();
    const { result } = renderHook(() => useSeries('a', 'temperature_c'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <StudioProvider store={store}>{children}</StudioProvider>
      ),
    });
    expect(result.current).toEqual([]);
  });
});

describe('useNow', () => {
  it('gives the time and renews it every interval', () => {
    const { result } = renderHook(() => useNow(1000));
    expect(result.current).toBe(T0);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(T0 + 3000);
  });

  it('clears its timer on unmount', () => {
    const clear = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useNow(500));
    unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});
