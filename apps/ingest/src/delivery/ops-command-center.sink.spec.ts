import type { AlertForDelivery } from './alert-sink';
import { RetryLater } from './alert-sink';
import { OpsCommandCenterSink } from './ops-command-center.sink';

const alert: AlertForDelivery = {
  id: '7',
  deviceId: 'dc-env-01',
  deviceName: 'Data center — row A',
  zoneCode: 'BLD-DC',
  ruleId: 'server-room-hot',
  metric: 'temperature_c',
  severity: 'high',
  title: 'Server room temperature high',
  incidentType: 'equipment_fault',
  openedAt: new Date('2026-10-01T08:00:00Z'),
  openedValue: 28.4,
  clearedAt: new Date('2026-10-01T08:10:00Z'),
  clearedValue: 24.9,
  externalRef: null,
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('OpsCommandCenterSink', () => {
  it('resolves the zone and creates an incident, returning its id', async () => {
    const fetchFn = jest
      .fn<Promise<Response>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(json([{ id: 'zone-uuid', code: 'BLD-DC' }]))
      .mockResolvedValueOnce(json({ id: 'incident-uuid' }, 201));
    const sink = new OpsCommandCenterSink('http://occ/api/', fetchFn as typeof fetch);

    await expect(sink.opened(alert)).resolves.toBe('incident-uuid');

    expect(fetchFn.mock.calls[0]![0]).toBe('http://occ/api/zones');
    const [url, init] = fetchFn.mock.calls[1]!;
    expect(url).toBe('http://occ/api/incidents');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      type: 'equipment_fault',
      severity: 'high',
      title: 'Server room temperature high',
      zoneId: 'zone-uuid',
    });
    expect(JSON.parse(init!.body as string).description).toContain('telemetry alert #7');
  });

  it('fails clearly when the zone does not exist in the command center', async () => {
    const fetchFn = jest.fn().mockResolvedValue(json([]));
    const sink = new OpsCommandCenterSink('http://occ/api', fetchFn as unknown as typeof fetch);
    await expect(sink.opened(alert)).rejects.toThrow('zone BLD-DC does not exist');
  });

  it('resolves the incident on clear, and treats "already resolved" as success', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ statusCode: 409 }, 409));
    const sink = new OpsCommandCenterSink('http://occ/api', fetchFn as unknown as typeof fetch);

    await sink.cleared({ ...alert, externalRef: 'incident-uuid' });
    expect(fetchFn.mock.calls[0]![0]).toBe('http://occ/api/incidents/incident-uuid/resolve');
    await expect(sink.cleared({ ...alert, externalRef: 'incident-uuid' })).resolves.toBeUndefined();
  });

  it('asks to retry a clear whose incident has not been created yet', async () => {
    const sink = new OpsCommandCenterSink('http://occ/api', jest.fn() as unknown as typeof fetch);
    await expect(sink.cleared(alert)).rejects.toBeInstanceOf(RetryLater);
  });

  it('surfaces server errors so the outbox retries', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(json([{ id: 'zone-uuid', code: 'BLD-DC' }]))
      .mockResolvedValueOnce(json({ message: 'down' }, 503));
    const sink = new OpsCommandCenterSink('http://occ/api', fetchFn as unknown as typeof fetch);
    await expect(sink.opened(alert)).rejects.toThrow('503');
  });
});
