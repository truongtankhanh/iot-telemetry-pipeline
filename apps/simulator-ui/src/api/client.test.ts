import { describe, expect, it, vi } from 'vitest';
import { stateViewFixture as fixture } from './fixtures/stateView';
import { ApiError, getState } from './client';

// A real `GET /api/state` body (see types.ts for how both sides are kept in step).
const view = fixture;
const keys = (value: object) => Object.keys(value).sort();

const reply = (body: unknown, init: ResponseInit = {}) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), init));

describe('the state fixture', () => {
  it('has the shape Studio reads', () => {
    expect(view.engine.devices.length).toBe(view.devices.length);
    expect(view.devices[0]?.zoneCode).toBe('BLD-DC');
    expect(view.broker).toEqual({ url: 'mqtt://localhost:1883', port: 1883, connected: true });
    expect(view.ingest.status).toBe('ready');
    expect(view.alerts.alerts[0]?.observed.delivered.opened).not.toBeNull();
    expect(view.config.simulated).toBe(true);
    expect(view.scenarios).toEqual(['server-room-overheat', 'crowded-lecture']);
  });

  it('carries the four rules of ingest and a profile for every metric of every device', () => {
    expect(view.rules.available).toBe(true);
    expect(view.rules.reason).toBeNull();
    expect(view.rules.items.map((rule) => rule.id)).toEqual([
      'server-room-hot',
      'server-room-humid',
      'indoor-co2',
      'power-over-contract',
    ]);
    for (const device of view.devices) {
      expect(keys(view.profiles[device.id]!)).toEqual([...device.metrics].sort());
    }
  });
});

describe('the types and the fixture', () => {
  it('declare the same keys, section by section', () => {
    expect(keys(view)).toEqual([
      'alerts',
      'broker',
      'config',
      'devices',
      'engine',
      'ingest',
      'metrics',
      'observationCursor',
      'profiles',
      'rules',
      'scenarios',
    ]);
    expect(keys(view.engine)).toEqual([
      'anomalies',
      'devices',
      'elapsedS',
      'intervalMs',
      'nowMs',
      'published',
      'running',
      'simulated',
    ]);
    expect(keys(view.engine.devices[0]!)).toEqual(['holds', 'id', 'intervalMs', 'seq', 'state']);
    expect(keys(view.devices[0]!)).toEqual(['id', 'kind', 'metrics', 'name', 'zoneCode']);
    expect(keys(view.config)).toEqual(['consoleUrl', 'ingestUrl', 'intervalMs', 'simulated']);
    expect(keys(view.broker)).toEqual(['connected', 'port', 'url']);
    expect(keys(view.ingest)).toEqual([
      'alertSink',
      'broker',
      'database',
      'detail',
      'lastCheckedAt',
      'since',
      'status',
    ]);
    expect(keys(view.alerts)).toEqual(['alerts', 'lastOkAt', 'stale']);
    expect(keys(view.alerts.alerts[0]!)).toEqual(
      [
        'clearedAt',
        'clearedValue',
        'deliveryAttempts',
        'deliveryError',
        'deliveryStatus',
        'deviceId',
        'externalRef',
        'id',
        'metric',
        'observed',
        'openedAt',
        'openedValue',
        'preexisting',
        'ruleId',
        'severity',
        'status',
        'title',
      ].sort(),
    );
    expect(keys(view.alerts.alerts[0]!.observed)).toEqual([
      'clearedAt',
      'delivered',
      'incident',
      'openedAt',
    ]);
    expect(keys(view.metrics)).toEqual(['lastOkAt', 'samples', 'stale']);
    expect(keys(view.metrics.samples[0]!)).toEqual(['labels', 'name', 'value']);
    expect(keys(view.rules)).toEqual(['available', 'items', 'reason']);
    expect(keys(view.rules.items[0]!)).toEqual([
      'clear',
      'direction',
      'for',
      'id',
      'kind',
      'metric',
      'raise',
      'severity',
      'title',
    ]);
    expect(keys(view.profiles)).toEqual(
      keys(Object.fromEntries(view.devices.map((d) => [d.id, 0]))),
    );
    expect(keys(view.profiles['dc-env-01']!.temperature_c!)).toEqual([
      'baseline',
      'dailySwing',
      'noise',
    ]);
  });
});

describe('getState', () => {
  it('reads the state from /api/state', async () => {
    const fetchFn = reply(view);
    const state = await getState({ fetch: fetchFn as unknown as typeof fetch });
    expect(state).toEqual(view);
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/state',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('turns the error envelope into an ApiError with its message and status', async () => {
    const fetchFn = reply(
      { statusCode: 403, error: 'Forbidden', message: 'The Host header must name this machine' },
      { status: 403 },
    );
    const failure = await getState({ fetch: fetchFn as unknown as typeof fetch }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(403);
    expect((failure as ApiError).message).toBe('The Host header must name this machine');
  });

  it('says HTTP <status> when a refusal has no message', async () => {
    const failure = await getState({
      fetch: reply({}, { status: 500 }) as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect((failure as ApiError).message).toBe('HTTP 500');
  });

  it('reports a body that is not JSON', async () => {
    const failure = await getState({
      fetch: reply('<html>', { status: 200 }) as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toMatch(/not JSON/);
  });

  it('reports a JSON body that is not a state', async () => {
    const failure = await getState({
      fetch: reply({ hello: 'world' }) as unknown as typeof fetch,
    }).catch((e: unknown) => e);
    expect((failure as ApiError).message).toMatch(/does not understand/);
  });

  it('reports a simulator that does not answer, with status 0', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const failure = await getState({ fetch: fetchFn as unknown as typeof fetch }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(0);
    expect((failure as ApiError).message).toBe('Cannot reach the simulator');
  });

  it('lets an abort through as an abort, not as an outage', async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(getState({ fetch: fetchFn as unknown as typeof fetch })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
