import { act, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { stateViewFixture } from '../../api/fixtures/stateView';
import { PulseBus } from '../../state/pulses';
import { viewWithDevices } from '../fleet/fleetTestSupport';
import { flowOf, graphNode, installReactFlowStubs, renderGraph } from './topologyTestSupport';

let restoreStubs: () => void;
beforeAll(() => {
  restoreStubs = installReactFlowStubs();
});
afterAll(() => restoreStubs());

const inner = (id: string, kind: 'device' | 'zone' | 'stage') =>
  graphNode(id)?.querySelector(`[data-kind="${kind}"], [data-mode]`) as HTMLElement;
const edge = (id: string) =>
  document.querySelector<SVGGElement>(`.react-flow__edge[data-id="${id}"] [data-state]`);
const nodeCount = () => document.querySelectorAll('.react-flow__node').length;

describe('a device node', () => {
  it('draws each state as an attribute, an icon and a word, never light alone', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(nodeCount()).toBe(18));
    expect(inner('device:dc-env-01', 'device')).toHaveAttribute('data-state', 'anomaly');
    expect(inner('device:dc-env-02', 'device')).toHaveAttribute('data-state', 'healthy');
    expect(inner('device:hub-power-01', 'device')).toHaveAttribute('data-state', 'stale');
    expect(
      within(graphNode('device:dc-env-01') as HTMLElement).getByText('Anomaly'),
    ).toBeInTheDocument();
    expect(
      within(graphNode('device:dc-env-02') as HTMLElement).getByText('Running'),
    ).toBeInTheDocument();
    expect(
      within(graphNode('device:hub-power-01') as HTMLElement).getByText('Paused'),
    ).toBeInTheDocument();
  });

  it('shows the id and the newest reading, with its unit', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(graphNode('device:dc-env-01')).not.toBeNull());
    const node = graphNode('device:dc-env-01') as HTMLElement;
    expect(within(node).getByText('dc-env-01')).toBeInTheDocument();
    expect(within(node).getByText('29.3 °C')).toBeInTheDocument();
  });

  it('moves only when it needs a look: an anomaly pulses, a healthy or a paused device holds still', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(nodeCount()).toBe(18));
    expect(inner('device:dc-env-01', 'device')).toHaveAttribute('data-animated', 'true');
    expect(inner('device:dc-env-02', 'device')).not.toHaveAttribute('data-animated');
    expect(inner('device:hub-power-01', 'device')).not.toHaveAttribute('data-animated');
  });

  it('breathes when it is the selected one, and says it is selected', async () => {
    renderGraph(flowOf(undefined, { selection: { type: 'device', id: 'dc-env-02' } }));
    await waitFor(() => expect(nodeCount()).toBe(18));
    const node = inner('device:dc-env-02', 'device');
    expect(node).toHaveAttribute('data-selected', 'true');
    expect(node).toHaveAttribute('data-animated', 'true');
  });

  it('is dimmed, and holds still, when the link to the simulator is lost', async () => {
    renderGraph(flowOf(undefined, { link: 'lost' }));
    await waitFor(() => expect(nodeCount()).toBe(18));
    const node = inner('device:dc-env-01', 'device');
    expect(node).toHaveAttribute('data-dimmed', 'true');
    expect(node).not.toHaveAttribute('data-animated');
  });

  it('is ringed, with a mark, when the Lab aims a fault at it, and no other device is', async () => {
    renderGraph(flowOf(undefined, { targets: new Set(['dc-env-02']) }));
    await waitFor(() => expect(nodeCount()).toBe(18));
    expect(inner('device:dc-env-02', 'device')).toHaveAttribute('data-targeted', 'true');
    expect(
      within(graphNode('device:dc-env-02') as HTMLElement).getByTitle('Target of the fault'),
    ).toBeInTheDocument();
    expect(inner('device:dc-env-01', 'device')).not.toHaveAttribute('data-targeted');
    expect(
      within(graphNode('device:dc-env-01') as HTMLElement).queryByTitle('Target of the fault'),
    ).not.toBeInTheDocument();
  });
});

describe('a zone node', () => {
  it('says how many devices it has and what is not well in them', async () => {
    renderGraph(flowOf(undefined, { group: 'zone' }));
    await waitFor(() => expect(graphNode('zone:BLD-DC')).not.toBeNull());
    const dc = graphNode('zone:BLD-DC') as HTMLElement;
    expect(within(dc).getByText('2 devices')).toBeInTheDocument();
    expect(within(dc).getByText('1 anomaly')).toBeInTheDocument();
    expect(
      within(graphNode('zone:BLD-LIB') as HTMLElement).getByText('all healthy'),
    ).toBeInTheDocument();
    expect(
      within(graphNode('zone:BLD-HUB') as HTMLElement).getByText('1 paused or silent'),
    ).toBeInTheDocument();
  });

  it('has a chevron that opens it, with a name that says which zone and how many devices', async () => {
    renderGraph(flowOf(undefined, { group: 'zone' }));
    await waitFor(() => expect(graphNode('zone:BLD-DC')).not.toBeNull());
    const chevron = screen.getByRole('button', { name: 'Open BLD-DC, 2 devices' });
    expect(chevron).toHaveAttribute('aria-expanded', 'false');
    expect(chevron).not.toHaveAttribute('aria-disabled');
  });

  it('shows counts only, with its states in words, above 60 devices', async () => {
    renderGraph(flowOf(viewWithDevices(61)));
    await waitFor(() => expect(graphNode('zone:BLD-Z0')).not.toBeNull());
    const zone = graphNode('zone:BLD-Z0') as HTMLElement;
    expect(zone.querySelector('[data-mode="counts"]')).not.toBeNull();
    expect(within(zone).getByText('21 devices')).toBeInTheDocument();
    expect(within(zone).getByText('all healthy')).toBeInTheDocument();
  });

  it('says "+ n more" for the devices it does not draw', async () => {
    const view = viewWithDevices(30);
    renderGraph(flowOf(view, { expanded: new Set(['BLD-Z0']) }));
    await waitFor(() => expect(graphNode('zone:BLD-Z0')).not.toBeNull());
    expect(
      within(graphNode('zone:BLD-Z0') as HTMLElement).getByText('+ 4 more'),
    ).toBeInTheDocument();
  });
});

describe('a stage node', () => {
  it('says what it is, its state in a word and the one figure Studio can stand behind', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(graphNode('stage:alert')).not.toBeNull());
    const alert = graphNode('stage:alert') as HTMLElement;
    expect(within(alert).getByText('Alert')).toBeInTheDocument();
    expect(within(alert).getByText('Open')).toBeInTheDocument();
    expect(within(alert).getByText('#7 · high')).toBeInTheDocument();
  });

  it('gives the two short stages no detail line, and the others one', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(nodeCount()).toBe(18));
    expect(inner('stage:database', 'stage')).toHaveAttribute('data-compact', 'true');
    expect(inner('stage:outbox', 'stage')).toHaveAttribute('data-compact', 'true');
    expect(inner('stage:ingest', 'stage')).not.toHaveAttribute('data-compact');
  });

  it('is dashed, dark and says "Unknown" when what it rests on does not answer', async () => {
    const view = structuredClone(stateViewFixture);
    view.ingest = {
      ...view.ingest,
      status: 'unreachable',
      database: null,
      broker: null,
      alertSink: null,
    };
    renderGraph(flowOf(view));
    await waitFor(() => expect(graphNode('stage:rules')).not.toBeNull());
    const rules = inner('stage:rules', 'stage');
    expect(rules).toHaveAttribute('data-state', 'stale');
    expect(rules).toHaveAttribute('data-dimmed', 'true');
    expect(
      within(graphNode('stage:rules') as HTMLElement).getByText('Unknown'),
    ).toBeInTheDocument();
  });

  it('is marked when it is the selected one', async () => {
    renderGraph(flowOf(undefined, { selection: { type: 'stage', id: 'ingest' } }));
    await waitFor(() => expect(graphNode('stage:ingest')).not.toBeNull());
    expect(inner('stage:ingest', 'stage')).toHaveAttribute('data-selected', 'true');
  });
});

describe('the edge', () => {
  it('has a state for each line: light where something moves, a dim wire where nothing does', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(edge('device:dc-env-02>broker')).not.toBeNull());
    expect(edge('device:dc-env-01>broker')).toHaveAttribute('data-state', 'warn');
    expect(edge('device:dc-env-02>broker')).toHaveAttribute('data-state', 'flowing');
    expect(edge('device:hub-power-01>broker')).toHaveAttribute('data-state', 'off');
    expect(edge('outbox>commandCenter')).toHaveAttribute('data-state', 'ok');
  });

  it('is three layers, and one more place for the dots', async () => {
    renderGraph(flowOf());
    await waitFor(() => expect(edge('device:dc-env-02>broker')).not.toBeNull());
    const group = edge('device:dc-env-02>broker') as SVGGElement;
    expect(group.querySelectorAll(':scope > path')).toHaveLength(3);
    expect(group.querySelectorAll(':scope > g')).toHaveLength(1);
  });

  it('is thicker for a zone than for a device', async () => {
    renderGraph(flowOf(undefined, { group: 'zone' }));
    await waitFor(() => expect(edge('zone:BLD-DC>broker')).not.toBeNull());
    const width = (id: string) =>
      Number(edge(id)?.querySelectorAll(':scope > path')[1]?.getAttribute('stroke-width'));
    // two devices behind it: 2.5; one: 2
    expect(width('zone:BLD-DC>broker')).toBe(2.5);
    expect(width('zone:BLD-LIB>broker')).toBe(2);
  });

  it('takes the animation budget only while it is lit', async () => {
    const { budget } = renderGraph(flowOf());
    await waitFor(() => expect(edge('device:dc-env-02>broker')).not.toBeNull());
    // 5 lit device edges + 6 pipeline edges, of which 5 are lit in the campus story; the dark ones take none
    const lit = [...document.querySelectorAll('.react-flow__edge [data-state]')].filter(
      (g) => g.getAttribute('data-state') !== 'off',
    );
    expect(budget.counts('line').held).toBeGreaterThanOrEqual(lit.length);
    expect(edge('device:hub-power-01>broker')).not.toHaveAttribute('data-glowing');
    expect(edge('device:dc-env-02>broker')).toHaveAttribute('data-glowing', 'true');
  });
});

describe('the dots on an edge', () => {
  let restorePath: () => void;
  const matchMedia = window.matchMedia;

  beforeAll(() => {
    // jsdom cannot measure a path: a straight one of length 100 stands in
    const proto = SVGElement.prototype as unknown as Record<string, unknown>;
    const had = { total: proto.getTotalLength, point: proto.getPointAtLength };
    proto.getTotalLength = () => 100;
    proto.getPointAtLength = (at: number) => ({ x: at, y: 0 });
    restorePath = () => {
      proto.getTotalLength = had.total;
      proto.getPointAtLength = had.point;
    };
  });
  afterAll(() => restorePath());
  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = matchMedia;
  });

  const dots = (id: string) =>
    document.querySelectorAll(`.react-flow__edge[data-id="${id}"] circle`).length;

  async function lit(bus = new PulseBus()) {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    renderGraph(flowOf(), {}, { pulses: bus });
    await waitFor(() => expect(edge('device:dc-env-02>broker')).not.toBeNull());
    return bus;
  }

  it('starts one when its device publishes', async () => {
    const bus = await lit();
    act(() => bus.emit('dc-env-02', Date.now()));
    expect(dots('device:dc-env-02>broker')).toBe(1);
  });

  it('draws at most four at once, however many messages arrive', async () => {
    const bus = await lit();
    act(() => {
      for (let i = 0; i < 10; i++) bus.emit('dc-env-02', Date.now());
    });
    expect(dots('device:dc-env-02>broker')).toBe(4);
  });

  it('removes a dot when it has crossed, and then takes another', async () => {
    const bus = await lit();
    act(() => {
      for (let i = 0; i < 4; i++) bus.emit('dc-env-02', Date.now());
    });
    act(() => {
      vi.advanceTimersByTime(1600);
    });
    expect(dots('device:dc-env-02>broker')).toBe(0);
    act(() => bus.emit('dc-env-02', Date.now()));
    expect(dots('device:dc-env-02>broker')).toBe(1);
  });

  it('draws none for a device that is paused: its edge carries nothing', async () => {
    const bus = await lit();
    act(() => bus.emit('hub-power-01', Date.now()));
    expect(dots('device:hub-power-01>broker')).toBe(0);
  });

  it('draws none under reduced motion', async () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    const bus = await lit();
    act(() => bus.emit('dc-env-02', Date.now()));
    expect(dots('device:dc-env-02>broker')).toBe(0);
  });

  it('draws a dot on a pipeline edge when its hop advances', async () => {
    const bus = await lit();
    act(() => bus.emit('hop:ingest>rules', Date.now()));
    expect(dots('ingest>rules')).toBe(1);
  });

  it('draws one on a zone edge for any of its devices', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const bus = new PulseBus();
    renderGraph(flowOf(undefined, { group: 'zone' }), {}, { pulses: bus });
    await waitFor(() => expect(edge('zone:BLD-DC>broker')).not.toBeNull());
    act(() => bus.emit('dc-env-01', Date.now()));
    act(() => bus.emit('dc-env-02', Date.now()));
    expect(dots('zone:BLD-DC>broker')).toBe(2);
  });
});
