/**
 * What the tests of the topology share: the stubs React Flow needs in jsdom, and a render that puts a page (or a piece
 * of one) in a router, a store, a history, a pulse bus and an animation budget. Not a `*.test.tsx`, so Vitest does not
 * run it as a test file. The stubs are installed by the tests that draw the graph, not by `src/test-setup.ts`, which
 * every test runs: a graph is the only thing that needs them.
 */
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { stateViewFixture } from '../../api/fixtures/stateView';
import type { StateView } from '../../api/types';
import { AnimationBudget } from '../../lib/animationBudget';
import { HistoryStore } from '../../state/history';
import { PulseBus } from '../../state/pulses';
import { StudioProvider } from '../../state/StudioProvider';
import { createStudioStore, type LinkState, type StudioStore } from '../../state/store';
import { AnimationBudgetProvider } from '../../ui/AnimationBudget';
import { AddressProbe } from '../fleet/AddressProbe';
import { seedHistory } from '../fleet/fleetTestSupport';

type Restore = () => void;

/** The width and height jsdom has no layout to give: a canvas of a usual size. */
const CANVAS = { width: 1200, height: 700 };

/**
 * jsdom has no `ResizeObserver`, no `DOMMatrixReadOnly`, no layout (`offsetWidth` and `offsetHeight` are 0) and no
 * `getBBox`, and React Flow needs all four to measure a canvas and place its nodes. These are the stand-ins React
 * Flow's own testing guide gives, with a canvas that has a size. Returns the function that puts everything back, for
 * an `afterAll`.
 */
export function installReactFlowStubs(): Restore {
  const restores: Restore[] = [];
  const globals = globalThis as unknown as Record<string, unknown>;

  const define = (name: string, value: unknown) => {
    const had = Object.hasOwn(globals, name);
    const before = globals[name];
    globals[name] = value;
    restores.push(() => {
      if (had) globals[name] = before;
      else delete globals[name];
    });
  };

  class ResizeObserverStub {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element): void {
      const entry = {
        target,
        contentRect: {
          ...CANVAS,
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: CANVAS.width,
          bottom: CANVAS.height,
        },
      } as unknown as ResizeObserverEntry;
      this.callback([entry], this as unknown as ResizeObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  define('ResizeObserver', ResizeObserverStub);

  class DOMMatrixReadOnlyStub {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
      this.m22 = scale === undefined ? 1 : Number(scale);
    }
  }
  define('DOMMatrixReadOnly', DOMMatrixReadOnlyStub);

  const proto = HTMLElement.prototype;
  for (const [property, style, fallback] of [
    ['offsetWidth', 'width', CANVAS.width],
    ['offsetHeight', 'height', CANVAS.height],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(proto, property);
    Object.defineProperty(proto, property, {
      configurable: true,
      get(this: HTMLElement) {
        return Number.parseFloat(this.style[style]) || fallback;
      },
    });
    restores.push(() => {
      if (original) Object.defineProperty(proto, property, original);
      else delete (proto as unknown as Record<string, unknown>)[property];
    });
  }

  const bbox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox');
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
  restores.push(() => {
    if (bbox) Object.defineProperty(SVGElement.prototype, 'getBBox', bbox);
    else delete (SVGElement.prototype as unknown as Record<string, unknown>).getBBox;
  });

  return () => restores.reverse().forEach((restore) => restore());
}

export interface RenderTopologyOptions {
  /** The address to open (`/topology?device=dc-env-01`). */
  path?: string;
  link?: LinkState;
  /** The state view; the fixture's six devices by default, `null` for the page before its first message. */
  view?: StateView | null;
  /** Seed the history with a few seconds of readings (the fixture's story). */
  seed?: boolean;
  /** A bus of the test's own, to emit pulses into. */
  pulses?: PulseBus;
}

export type TopologyHarness = RenderResult & {
  store: StudioStore;
  history: HistoryStore;
  pulses: PulseBus;
  budget: AnimationBudget;
};

/** Renders a topology element at `/topology` inside everything the page reads. */
export function renderTopology(
  element: ReactElement,
  options: RenderTopologyOptions = {},
): TopologyHarness {
  const { path = '/topology', link = 'live', seed = true } = options;
  const view = options.view === undefined ? structuredClone(stateViewFixture) : options.view;
  const store = createStudioStore();
  store.getState().setLink(link, Date.now());
  if (view) store.getState().setView(structuredClone(view), Date.now());
  const history = new HistoryStore();
  if (view && seed) seedHistory(history, view);
  const pulses = options.pulses ?? new PulseBus();
  const budget = new AnimationBudget();

  const result = render(
    <StudioProvider store={store} history={history} pulses={pulses}>
      <AnimationBudgetProvider budget={budget}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/topology" element={element} />
          </Routes>
          <AddressProbe />
        </MemoryRouter>
      </AnimationBudgetProvider>
    </StudioProvider>,
  );
  return { ...result, store, history, pulses, budget };
}

export { address } from '../fleet/fleetTestSupport';
