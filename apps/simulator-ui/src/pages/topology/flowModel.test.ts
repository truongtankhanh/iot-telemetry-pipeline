import { describe, expect, it } from 'vitest';
import type { DeviceNodeData, TopoEdge, TopoNode, ZoneNodeData } from '../../lib/topology';
import { type FlowNode, miniState, selectionFromId, toFlowEdges, toFlowNodes } from './flowModel';

const device = (selected = false): DeviceNodeData => ({
  kind: 'device',
  deviceId: 'dc-env-01',
  name: 'Data center — row A',
  code: 'DC·1',
  deviceKind: 'server_room',
  zone: 'BLD-DC',
  state: 'anomaly',
  word: 'Anomaly',
  metric: 'temperature_c',
  reading: '29.3 °C',
  reason: null,
  selected,
  dimmed: false,
  ariaLabel: 'Data center — row A, temperature_c 29.3 °C, anomaly',
});

const zone: ZoneNodeData = {
  kind: 'zone',
  code: 'BLD-DC',
  count: 2,
  worst: 'anomaly',
  mode: 'open',
  counts: { healthy: 1, anomaly: 1, down: 0, stale: 0 },
  more: 0,
  locked: true,
  selected: false,
  dimmed: false,
  ariaLabel: 'BLD-DC, 2 devices, anomaly',
};

const node = (id: string, data: TopoNode['data'], parentId?: string): TopoNode => ({
  id,
  type: data.kind,
  ...(parentId === undefined ? {} : { parentId }),
  position: { x: 14, y: 30 },
  width: 204,
  height: 40,
  data,
});

describe('toFlowNodes', () => {
  const nodes = toFlowNodes([
    node('zone:BLD-DC', zone),
    node('device:dc-env-01', device(true), 'zone:BLD-DC'),
  ]);

  it('keeps the id, the type, the place and the size', () => {
    expect(nodes[1]).toMatchObject({
      id: 'device:dc-env-01',
      type: 'device',
      parentId: 'zone:BLD-DC',
      position: { x: 14, y: 30 },
      width: 204,
      height: 40,
    });
  });

  it('gives a node with no parent no `parentId` at all', () => {
    expect(Object.hasOwn(nodes[0] as object, 'parentId')).toBe(false);
  });

  it('draws the picture and nothing else: no dragging, no connecting, no deleting', () => {
    for (const n of nodes) {
      expect(n).toMatchObject({ draggable: false, connectable: false, deletable: false });
      expect(n).toMatchObject({ selectable: true, focusable: true });
    }
  });

  it('takes the selection and the accessible name from the model', () => {
    expect(nodes[1]).toMatchObject({
      selected: true,
      ariaLabel: 'Data center — row A, temperature_c 29.3 °C, anomaly',
    });
    expect(nodes[0]?.selected).toBe(false);
  });
});

describe('toFlowEdges', () => {
  const edge: TopoEdge = {
    id: 'device:dc-env-01>broker',
    source: 'device:dc-env-01',
    sourceHandle: 'right',
    target: 'stage:broker',
    targetHandle: 'left',
    state: 'warn',
    weight: 1,
    devices: ['dc-env-01'],
    hop: null,
  };
  const [flow] = toFlowEdges([edge]);

  it('is the neon edge with its state, weight, devices and hop as data', () => {
    expect(flow).toMatchObject({
      id: 'device:dc-env-01>broker',
      type: 'neon',
      source: 'device:dc-env-01',
      sourceHandle: 'right',
      target: 'stage:broker',
      targetHandle: 'left',
      data: { state: 'warn', weight: 1, devices: ['dc-env-01'], hop: null },
    });
  });

  it('is decorative: no focus, no selection, hidden from a screen reader', () => {
    expect(flow).toMatchObject({
      selectable: false,
      focusable: false,
      domAttributes: { 'aria-hidden': true },
    });
  });
});

describe('selectionFromId', () => {
  it('reads a device, a zone and a stage', () => {
    expect(selectionFromId('device:dc-env-01')).toEqual({ type: 'device', id: 'dc-env-01' });
    expect(selectionFromId('zone:BLD-DC')).toEqual({ type: 'zone', id: 'BLD-DC' });
    expect(selectionFromId('stage:rules')).toEqual({ type: 'stage', id: 'rules' });
  });

  it('keeps a colon that is part of the id', () => {
    expect(selectionFromId('device:a:b')).toEqual({ type: 'device', id: 'a:b' });
  });

  it('is nothing for an id it does not know', () => {
    expect(selectionFromId('stage:nowhere')).toBeNull();
    expect(selectionFromId('edge:x')).toBeNull();
    expect(selectionFromId('device:')).toBeNull();
    expect(selectionFromId('plain')).toBeNull();
  });
});

describe('miniState', () => {
  it('is the state a node is drawn in', () => {
    const [z, d] = toFlowNodes([node('zone:BLD-DC', zone), node('device:x', device())]) as [
      FlowNode,
      FlowNode,
    ];
    expect(miniState(z)).toBe('anomaly');
    expect(miniState(d)).toBe('anomaly');
  });
});
