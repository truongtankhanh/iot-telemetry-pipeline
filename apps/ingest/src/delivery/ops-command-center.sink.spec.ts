import type { AlertForDelivery } from './alert-sink';
import { RetryLater } from './alert-sink';
import { ClientCredentials } from './client-credentials';
import { idempotencyKey, OpsCommandCenterSink } from './ops-command-center.sink';

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

describe('OpsCommandCenterSink with a token source', () => {
  const tokens = () => {
    let n = 0;
    return { token: jest.fn(async () => `token-${++n}`), invalidate: jest.fn() };
  };

  it('sends a bearer token and an idempotency key derived from the alert', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(json([{ id: 'zone-uuid', code: 'BLD-DC' }]))
      .mockResolvedValueOnce(json({ id: 'incident-uuid' }, 201));
    const source = tokens();
    const sink = new OpsCommandCenterSink(
      'http://occ/api',
      fetchFn as unknown as typeof fetch,
      source,
    );

    await sink.opened(alert);

    // Every request carries a token, the zone lookup included.
    const zoneHeaders = fetchFn.mock.calls[0]![1].headers as Record<string, string>;
    expect(zoneHeaders.Authorization).toMatch(/^Bearer token-\d$/);
    const headers = fetchFn.mock.calls[1]![1].headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer token-\d$/);
    expect(headers['Idempotency-Key']).toBe('telemetry-alert-7');
    // The same alert always yields the same key, so a retried creation is answered with the
    // incident created the first time.
    expect(idempotencyKey({ id: '7' })).toBe(headers['Idempotency-Key']);
  });

  it('renews the token once on 401 and repeats the request', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(json({ statusCode: 401 }, 401))
      .mockResolvedValueOnce(json({}));
    const source = tokens();
    const sink = new OpsCommandCenterSink(
      'http://occ/api',
      fetchFn as unknown as typeof fetch,
      source,
    );

    await sink.cleared({ ...alert, externalRef: 'incident-uuid' });

    expect(source.invalidate).toHaveBeenCalledTimes(1);
    expect((fetchFn.mock.calls[1]![1].headers as Record<string, string>).Authorization).toBe(
      'Bearer token-2',
    );
  });

  it('does not loop when the credentials are refused', async () => {
    const fetchFn = jest.fn().mockResolvedValue(json({ statusCode: 401 }, 401));
    const sink = new OpsCommandCenterSink(
      'http://occ/api',
      fetchFn as unknown as typeof fetch,
      tokens(),
    );
    await expect(sink.cleared({ ...alert, externalRef: 'x' })).rejects.toThrow('→ 401');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('ClientCredentials', () => {
  const tokenResponse = (token: string, expiresIn = 300) =>
    json({ access_token: token, expires_in: expiresIn, token_type: 'Bearer' });

  it('posts the client credentials grant and caches the token until shortly before expiry', async () => {
    let now = 0;
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('a'))
      .mockResolvedValueOnce(tokenResponse('b'));
    const source = new ClientCredentials(
      'http://idp/token',
      'telemetry-pipeline',
      's3cret',
      fetchFn as unknown as typeof fetch,
      () => now,
    );

    expect(await source.token()).toBe('a');
    const body = new URLSearchParams(fetchFn.mock.calls[0]![1].body as URLSearchParams);
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'telemetry-pipeline',
      client_secret: 's3cret',
    });

    now = 269_000; // 300 s lifetime, renewed 30 s early
    expect(await source.token()).toBe('a');
    now = 271_000;
    expect(await source.token()).toBe('b');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent callers, and refetches after invalidate', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(tokenResponse('a'))
      .mockResolvedValueOnce(tokenResponse('b'));
    const source = new ClientCredentials(
      'http://idp/token',
      'c',
      's',
      fetchFn as unknown as typeof fetch,
    );

    await expect(Promise.all([source.token(), source.token()])).resolves.toEqual(['a', 'a']);
    source.invalidate();
    expect(await source.token()).toBe('b');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('reports a refused client without echoing the secret', async () => {
    const fetchFn = jest.fn().mockResolvedValue(json({ error: 'invalid_client' }, 401));
    const source = new ClientCredentials(
      'http://idp/token',
      'c',
      'top-secret',
      fetchFn as unknown as typeof fetch,
    );
    const error = await source.token().catch((e: Error) => e);
    expect(String(error)).toContain('invalid_client');
    expect(String(error)).not.toContain('top-secret');
  });
});
