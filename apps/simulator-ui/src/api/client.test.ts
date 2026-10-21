import { describe, expect, it, vi } from 'vitest';
import alertsPageFixture from './fixtures/alerts-page.json';
import { stateViewFixture as fixture } from './fixtures/stateView';
import {
  ApiError,
  getAlerts,
  getState,
  holdValue,
  pauseDevice,
  releaseValue,
  setDeviceInterval,
  startDevice,
  stopDevice,
} from './client';
import type { ScenarioRunView } from './types';

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
      'runs',
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

  it('declare the keys of a run, which the simulator pins from its side in scenario-runs.test.ts', () => {
    const run: ScenarioRunView = {
      id: 'r1',
      scenario: 'server-room-overheat',
      startedAt: '2026-10-21T08:00:00.000Z',
      offsetS: 10,
      endsAtS: 90,
      anomalyIds: ['a1'],
      startedDevices: [],
    };
    expect(view.runs).toEqual([]);
    expect(keys(run)).toEqual([
      'anomalyIds',
      'endsAtS',
      'id',
      'offsetS',
      'scenario',
      'startedAt',
      'startedDevices',
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

describe('device commands', () => {
  const asFetch = (fn: unknown) => fn as typeof fetch;
  /** The method, URL, headers and body a command sent. */
  const sent = (fn: ReturnType<typeof reply>) => {
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    return { url, method: init.method, headers: init.headers, body: init.body };
  };

  it.each([
    ['start', startDevice],
    ['pause', pauseDevice],
    ['stop', stopDevice],
  ] as const)(
    '%s is a POST with no body, as JSON, and answers the new state',
    async (action, run) => {
      const fetchFn = reply(view);
      const state = await run('dc-env-01', { fetch: asFetch(fetchFn) });
      expect(state).toEqual(view);
      expect(sent(fetchFn)).toEqual({
        url: `/api/devices/dc-env-01/${action}`,
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: undefined,
      });
    },
  );

  it('puts the interval, or null for the engine default', async () => {
    const fetchFn = reply(view);
    await setDeviceInterval('dc-env-01', 500, { fetch: asFetch(fetchFn) });
    expect(sent(fetchFn)).toMatchObject({
      url: '/api/devices/dc-env-01/interval',
      method: 'PUT',
      body: '{"intervalMs":500}',
    });
    const other = reply(view);
    await setDeviceInterval('dc-env-01', null, { fetch: asFetch(other) });
    expect(sent(other).body).toBe('{"intervalMs":null}');
  });

  it('refuses an interval that is not a positive number before sending anything', async () => {
    const fetchFn = reply(view);
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        setDeviceInterval('dc-env-01', bad, { fetch: asFetch(fetchFn) }),
      ).rejects.toBeInstanceOf(ApiError);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('holds a value on a metric, and releases it', async () => {
    const hold = reply(view);
    await holdValue('dc-env-01', 'temperature_c', 31.5, { fetch: asFetch(hold) });
    expect(sent(hold)).toMatchObject({
      url: '/api/devices/dc-env-01/holds/temperature_c',
      method: 'PUT',
      body: '{"value":31.5}',
    });
    const release = reply(view);
    await releaseValue('dc-env-01', 'temperature_c', { fetch: asFetch(release) });
    expect(sent(release)).toMatchObject({
      url: '/api/devices/dc-env-01/holds/temperature_c',
      method: 'DELETE',
      body: undefined,
    });
  });

  it('holds 0 (a legitimate value), and refuses a value that is not a finite number before sending', async () => {
    const fetchFn = reply(view);
    await holdValue('hub-power-01', 'power_kw', 0, { fetch: asFetch(fetchFn) });
    expect(sent(fetchFn).body).toBe('{"value":0}');
    const never = reply(view);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        holdValue('dc-env-01', 'temperature_c', bad, { fetch: asFetch(never) }),
      ).rejects.toBeInstanceOf(ApiError);
    }
    expect(never).not.toHaveBeenCalled();
  });

  it('percent-encodes the device id and the metric in the path', async () => {
    const fetchFn = reply(view);
    await holdValue('a b/c', 'x?y', 1, { fetch: asFetch(fetchFn) });
    expect(sent(fetchFn).url).toBe('/api/devices/a%20b%2Fc/holds/x%3Fy');
  });

  it('turns a refusal of the simulator into an ApiError with its message', async () => {
    const fetchFn = reply(
      { statusCode: 404, error: 'Not Found', message: 'Unknown device "ghost"' },
      { status: 404 },
    );
    const failure = await pauseDevice('ghost', { fetch: asFetch(fetchFn) }).catch(
      (e: unknown) => e,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
    expect((failure as ApiError).message).toBe('Unknown device "ghost"');
  });

  it('reports a simulator that does not answer, with status 0', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const failure = await stopDevice('dc-env-01', { fetch: asFetch(fetchFn) }).catch(
      (e: unknown) => e,
    );
    expect((failure as ApiError).status).toBe(0);
  });

  it('passes an abort signal to the request', async () => {
    const fetchFn = reply(view);
    const controller = new AbortController();
    await startDevice('dc-env-01', { fetch: asFetch(fetchFn), signal: controller.signal });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});

describe('getAlerts', () => {
  const asFetch = (fn: unknown) => fn as typeof fetch;
  const page = alertsPageFixture;
  const replyPage = (body: unknown, init: ResponseInit = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), init));
  const urlOf = (fn: ReturnType<typeof replyPage>) => (fn.mock.calls[0] as unknown as [string])[0];

  it('asks for the page the request describes, with the cursor encoded and unread', async () => {
    const fetchFn = replyPage(page);
    await getAlerts({ status: 'open', limit: 5, before: 'ab+/=' }, { fetch: asFetch(fetchFn) });
    expect(urlOf(fetchFn)).toBe('/api/alerts?status=open&limit=5&before=ab%2B%2F%3D');

    const plain = replyPage(page);
    await getAlerts({}, { fetch: asFetch(plain) });
    expect(urlOf(plain)).toBe('/api/alerts');
  });

  it('returns the alerts and the cursor exactly as the simulator sent it', async () => {
    const fetchFn = replyPage(page, { headers: { 'X-Next-Cursor': 'eyJ0IjoiMjAyNiJ9' } });
    const result = await getAlerts({ limit: 2 }, { fetch: asFetch(fetchFn) });
    expect(result.alerts.map((alert) => alert.id)).toEqual(['7', '6']);
    expect(result.next).toBe('eyJ0IjoiMjAyNiJ9');
  });

  it('has no next cursor on the last page', async () => {
    const result = await getAlerts({}, { fetch: asFetch(replyPage(page)) });
    expect(result.next).toBeNull();
  });

  it('turns a refusal of the simulator into an ApiError with its message', async () => {
    const refused = replyPage(
      { statusCode: 502, error: 'Bad Gateway', message: 'ECONNREFUSED' },
      { status: 502 },
    );
    const failure = await getAlerts({}, { fetch: asFetch(refused) }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(502);
    expect((failure as ApiError).message).toBe('ECONNREFUSED');
  });

  it('fails loudly on a body that is not the documented array', async () => {
    for (const body of [{ alerts: [] }, [{ id: 7 }], [null], 'nope']) {
      const failure = await getAlerts({}, { fetch: asFetch(replyPage(body)) }).catch(
        (e: unknown) => e,
      );
      expect(failure).toBeInstanceOf(ApiError);
      expect((failure as ApiError).message).toMatch(/does not understand/);
    }
  });

  it('reports a simulator that does not answer with status 0, and passes an abort on', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const failure = await getAlerts({}, { fetch: asFetch(down) }).catch((e: unknown) => e);
    expect((failure as ApiError).status).toBe(0);

    const controller = new AbortController();
    const fetchFn = replyPage(page);
    await getAlerts({}, { fetch: asFetch(fetchFn), signal: controller.signal });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('declares the keys of the fixture, which the simulator’s own test also compares', () => {
    const keys = (value: object) => Object.keys(value).sort();
    expect(keys(page[0]!)).toEqual(
      [
        'cause',
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
    expect(keys(page[0]!.observed)).toEqual(['clearedAt', 'delivered', 'incident', 'openedAt']);
    expect(keys(page[0]!.cause!)).toEqual(['scenario', 'startedAt']);
    expect(page[1]!.cause).toBeNull();
  });
});
