import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ManualClock } from './clock.ts';
import {
  type FetchLike,
  IngestPoller,
  IngestReadError,
  type IngestState,
} from './ingest-poller.ts';
import type { ObservationDraft } from './observation-store.ts';

const T0 = Date.parse('2026-10-20T08:00:00.000Z');
const BASE = 'http://ingest:3100';

type Handler = (signal: AbortSignal) => Promise<Response>;
type Endpoint = 'ready' | 'alerts' | 'metrics';

const respond =
  (body: unknown, status = 200): Handler =>
  () =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
    );

const READY = { status: 'ready', database: 'up', broker: 'up', alertSink: 'ops-command-center' };
const refused: Handler = () =>
  Promise.reject(
    new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3100'), {
        code: 'ECONNREFUSED',
      }),
    }),
  );
/** Never answers; ends only when the poller aborts it (its timeout, or `stop()`). */
const hang: Handler = (signal) =>
  new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

const wireAlert = (overrides: Record<string, unknown> = {}) => ({
  id: '1',
  deviceId: 'dc-env-01',
  ruleId: 'server-room-hot',
  metric: 'temperature_c',
  severity: 'high',
  title: 'Server room temperature high',
  status: 'open',
  openedAt: '2026-10-20T07:59:30.000Z',
  openedValue: 29.3,
  clearedAt: null,
  clearedValue: null,
  externalRef: null,
  deliveryStatus: 'pending',
  deliveryAttempts: 0,
  deliveryError: null,
  ...overrides,
});

function setup(options: { timeoutMs?: number; pageTimeoutMs?: number } = {}) {
  const clock = new ManualClock(T0);
  const handlers: Record<Endpoint, Handler> = {
    ready: respond(READY),
    alerts: respond([]),
    metrics: respond('telemetry_sequence_gaps_total 3\nprocess_cpu_user_seconds_total 1\n'),
  };
  const calls: string[] = [];
  const fetchFn: FetchLike = (url, { signal }) => {
    calls.push(url);
    const path = new URL(url).pathname;
    const endpoint: Endpoint =
      path === '/api/ready' ? 'ready' : path === '/api/alerts' ? 'alerts' : 'metrics';
    return handlers[endpoint](signal);
  };
  const logs: string[] = [];
  const poller = new IngestPoller({
    baseUrl: BASE,
    clock,
    fetch: fetchFn,
    log: (line) => logs.push(line),
    ...options,
  });
  const seen = {
    ingest: [] as IngestState[],
    alerts: [] as { stale: boolean; count: number; lastOkAt: string | null }[],
    metrics: [] as { stale: boolean; count: number }[],
    observation: [] as { draft: ObservationDraft; at: string }[],
  };
  poller.on('ingest', (state) => seen.ingest.push(state));
  poller.on('alerts', (feed) =>
    seen.alerts.push({ stale: feed.stale, count: feed.alerts.length, lastOkAt: feed.lastOkAt }),
  );
  poller.on('metrics', (feed) =>
    seen.metrics.push({ stale: feed.stale, count: feed.samples.length }),
  );
  poller.on('observation', (draft, at) => seen.observation.push({ draft, at }));
  return { poller, clock, handlers, calls, logs, seen };
}

describe('IngestPoller requests', () => {
  it('reads the three endpoints of ingest in a cycle, alerts with a limit', async () => {
    const { poller, calls } = setup();
    await poller.pollOnce();
    assert.deepEqual(calls, [
      `${BASE}/api/ready`,
      `${BASE}/api/alerts?limit=100`,
      `${BASE}/metrics`,
    ]);
  });

  it('starts as unknown, with stale feeds, before any cycle', () => {
    const { poller } = setup();
    assert.equal(poller.state().status, 'unknown');
    assert.equal(poller.alerts().stale, true);
    assert.equal(poller.metrics().stale, true);
  });
});

describe('IngestPoller state of ingest', () => {
  it('reports ready with what ingest says about its dependencies, once, with one log line', async () => {
    const { poller, seen, logs } = setup();
    await poller.pollOnce();
    await poller.pollOnce();

    assert.equal(seen.ingest.length, 1);
    assert.deepEqual(
      { ...poller.state(), since: undefined, lastCheckedAt: undefined },
      {
        status: 'ready',
        database: 'up',
        broker: 'up',
        alertSink: 'ops-command-center',
        detail: null,
        since: undefined,
        lastCheckedAt: undefined,
      },
    );
    assert.equal(poller.state().since, '2026-10-20T08:00:00.000Z');
    assert.deepEqual(logs, [
      'ingest: ready (database up, broker up, alert sink ops-command-center)',
    ]);
  });

  it('reports the alert sink as none when ingest has no command center', async () => {
    const { poller, handlers } = setup();
    handlers.ready = respond({ ...READY, alertSink: 'none' });
    await poller.pollOnce();
    assert.equal(poller.state().alertSink, 'none');
  });

  it('reads a 503 from /api/ready as an answer: not ready, with the dependency that is down', async () => {
    const { poller, handlers, seen } = setup();
    handlers.ready = respond(
      { status: 'not ready', database: 'down', broker: 'up', alertSink: 'none' },
      503,
    );
    await poller.pollOnce();

    assert.equal(poller.state().status, 'not-ready');
    assert.equal(poller.state().database, 'down');
    assert.equal(poller.state().broker, 'up');
    assert.equal(seen.ingest.length, 1);
    // Ingest answered, so the other reads still count.
    assert.equal(poller.alerts().stale, false);
  });

  it('reports unreachable on the first failed cycle, for a refused connection', async () => {
    const { poller, handlers, seen, logs } = setup();
    handlers.ready = refused;
    await poller.pollOnce();

    assert.equal(poller.state().status, 'unreachable');
    assert.equal(poller.state().detail, 'ECONNREFUSED');
    assert.equal(poller.state().database, null);
    assert.equal(seen.ingest.length, 1);
    assert.deepEqual(logs, [`ingest: unreachable at ${BASE} (ECONNREFUSED)`]);
    const [first] = seen.observation;
    assert.equal(first?.draft.kind, 'dependency');
    assert.equal(first?.draft.data.from, 'unknown');
    assert.equal(first?.draft.data.to, 'unreachable');
  });

  it('says one thing about an outage, not one thing per cycle, and one thing when it ends', async () => {
    const { poller, handlers, seen, logs } = setup();
    await poller.pollOnce(); // ready
    handlers.ready = refused;
    await poller.pollOnce(); // unreachable
    await poller.pollOnce();
    await poller.pollOnce();
    assert.deepEqual(
      seen.ingest.map((s) => s.status),
      ['ready', 'unreachable'],
    );
    assert.equal(logs.length, 2);

    handlers.ready = respond(READY);
    await poller.pollOnce();
    assert.deepEqual(
      seen.ingest.map((s) => s.status),
      ['ready', 'unreachable', 'ready'],
    );
    const dependency = seen.observation.filter((o) => o.draft.kind === 'dependency');
    assert.deepEqual(
      dependency.map((o) => [o.draft.data.from, o.draft.data.to]),
      [
        ['unknown', 'ready'],
        ['ready', 'unreachable'],
        ['unreachable', 'ready'],
      ],
    );
  });

  it('keeps the time the status last changed', async () => {
    const { poller, handlers, clock } = setup();
    await poller.pollOnce();
    await clock.advance(5000);
    await poller.pollOnce(); // still ready
    assert.equal(poller.state().since, '2026-10-20T08:00:00.000Z');
    assert.equal(poller.state().lastCheckedAt, '2026-10-20T08:00:05.000Z');

    handlers.ready = refused;
    await clock.advance(1000);
    await poller.pollOnce();
    assert.equal(poller.state().since, '2026-10-20T08:00:06.000Z');
  });

  it('counts a request with no answer within the timeout as unreachable', async () => {
    const { poller, handlers } = setup({ timeoutMs: 20 });
    handlers.ready = hang;
    await poller.pollOnce();
    assert.equal(poller.state().status, 'unreachable');
    assert.equal(poller.state().detail, 'no answer within 20 ms');
  });

  it('counts a reply that is not the documented one, and another status, as unreachable', async () => {
    const { poller, handlers } = setup();
    handlers.ready = respond({});
    await poller.pollOnce();
    assert.equal(poller.state().detail, 'unexpected reply from /api/ready');

    handlers.ready = respond('<html>', 200);
    await poller.pollOnce();
    assert.equal(poller.state().detail, 'unexpected reply from /api/ready');

    handlers.ready = respond({ message: 'oops' }, 500);
    await poller.pollOnce();
    assert.equal(poller.state().status, 'unreachable');
    assert.equal(poller.state().detail, 'HTTP 500');
  });
});

describe('IngestPoller alerts and metrics', () => {
  it('turns new alerts into observations stamped with the time of the read', async () => {
    const { poller, handlers, clock, seen } = setup();
    await poller.pollOnce(); // baseline: nothing there yet
    await clock.advance(1000);
    handlers.alerts = respond([wireAlert()]);
    await poller.pollOnce();

    const alertEvents = seen.observation.filter((o) => o.draft.kind !== 'dependency');
    assert.deepEqual(
      alertEvents.map((o) => o.draft.kind),
      ['alert-opened', 'delivery'],
    );
    assert.ok(alertEvents.every((o) => o.at === '2026-10-20T08:00:01.000Z'));
    assert.equal(poller.alerts().alerts[0]?.observed.openedAt, '2026-10-20T08:00:01.000Z');
    assert.equal(poller.alerts().stale, false);
  });

  it('forwards the selected metrics of every successful read', async () => {
    const { poller, seen } = setup();
    await poller.pollOnce();
    await poller.pollOnce();
    assert.deepEqual(seen.metrics, [
      { stale: false, count: 1 },
      { stale: false, count: 1 },
    ]);
    assert.equal(poller.metrics().samples[0]?.name, 'telemetry_sequence_gaps_total');
  });

  it('keeps the last alerts, marked stale, when only /api/alerts fails, and says so once', async () => {
    const { poller, handlers, clock, seen } = setup();
    handlers.alerts = respond([wireAlert()]);
    await poller.pollOnce();
    const okAt = poller.alerts().lastOkAt;

    await clock.advance(1000);
    handlers.alerts = respond({ statusCode: 400 }, 400); // an older replica refusing `limit`
    await poller.pollOnce();
    await poller.pollOnce();

    assert.equal(poller.state().status, 'ready'); // not an outage
    assert.equal(poller.alerts().stale, true);
    assert.equal(poller.alerts().alerts.length, 1);
    assert.equal(poller.alerts().lastOkAt, okAt);
    assert.deepEqual(
      seen.alerts.map((a) => a.stale),
      [false, true],
    );

    handlers.alerts = respond([wireAlert()]);
    await poller.pollOnce();
    assert.deepEqual(
      seen.alerts.map((a) => a.stale),
      [false, true, false],
    );
  });

  it('keeps the last metrics, marked stale, when only /metrics fails', async () => {
    const { poller, handlers, seen } = setup();
    await poller.pollOnce();
    handlers.metrics = respond('nope', 500);
    await poller.pollOnce();
    assert.equal(poller.metrics().stale, true);
    assert.equal(poller.metrics().samples.length, 1);
    assert.equal(seen.metrics.at(-1)?.stale, true);
  });

  it('marks both stale and keeps ingest unreachable when nothing answers', async () => {
    const { poller, handlers } = setup();
    await poller.pollOnce();
    handlers.ready = refused;
    handlers.alerts = refused;
    handlers.metrics = refused;
    await poller.pollOnce();
    assert.equal(poller.state().status, 'unreachable');
    assert.equal(poller.alerts().stale, true);
    assert.equal(poller.metrics().stale, true);
  });
});

describe('IngestPoller schedule', () => {
  it('polls at once, then every interval on its clock', async () => {
    const { poller, clock, calls } = setup();
    await poller.start();
    assert.equal(calls.length, 3);
    await clock.advance(1000);
    assert.equal(calls.length, 6);
    await clock.advance(2000);
    assert.equal(calls.length, 12);
    poller.stop();
  });

  it('never starts a cycle while the last one is still running', async () => {
    const { poller, clock, handlers, calls } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    handlers.ready = async () => {
      await gate;
      return new Response(JSON.stringify(READY));
    };

    const first = poller.start();
    await clock.advance(5000); // no timer is armed while the cycle runs
    assert.equal(calls.length, 3);

    release();
    await first;
    assert.equal(calls.length, 3);
    await clock.advance(0); // the cycle outlasted its slot, so the next one is due at once
    assert.equal(calls.length, 6);
    poller.stop();
  });

  it('does not start twice', async () => {
    const { poller, calls } = setup();
    await poller.start();
    await poller.start();
    assert.equal(calls.length, 3);
    poller.stop();
  });

  it('stops polling after stop()', async () => {
    const { poller, clock, calls } = setup();
    await poller.start();
    poller.stop();
    await clock.advance(10_000);
    assert.equal(calls.length, 3);
  });

  it('aborts the requests in flight on stop() and drops their results', async () => {
    const { poller, handlers, seen, calls } = setup();
    handlers.ready = hang;
    const first = poller.start();
    poller.stop();
    await first;
    assert.equal(calls.length, 3);
    assert.equal(seen.ingest.length, 0);
    assert.equal(poller.state().status, 'unknown');
  });

  it('can be started again after stop()', async () => {
    const { poller, calls } = setup();
    await poller.start();
    poller.stop();
    await poller.start();
    assert.equal(calls.length, 6);
    poller.stop();
  });
});

describe('IngestPoller listeners', () => {
  it('goes on when a listener throws, and says so in the log', async () => {
    const { poller, logs, seen } = setup();
    poller.on('ingest', () => {
      throw new Error('boom');
    });
    await assert.doesNotReject(poller.pollOnce());
    assert.equal(seen.alerts.length, 1); // the alerts and metrics of the same cycle still went out
    assert.equal(seen.metrics.length, 1);
    assert.ok(logs.some((line) => line.includes('"ingest" listener threw')));
  });
});

const withCursor =
  (body: unknown, cursor: string | null, status = 200): Handler =>
  () =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        ...(cursor === null ? {} : { headers: { 'X-Next-Cursor': cursor } }),
      }),
    );

const readError = (kind: IngestReadError['kind'], message: string | RegExp) => (error: unknown) => {
  assert.ok(error instanceof IngestReadError, 'an IngestReadError');
  assert.equal(error.kind, kind);
  if (typeof message === 'string') assert.equal(error.message, message);
  else assert.match(error.message, message);
  return true;
};

describe('IngestPoller alertsPage', () => {
  it('sends the query to ingest, with the cursor URL-encoded and otherwise unread', async () => {
    const { poller, handlers, calls } = setup();
    handlers.alerts = withCursor([], null);

    await poller.alertsPage({ status: 'open', limit: 5, before: 'ab+/=?&x=1' });
    await poller.alertsPage();

    assert.deepEqual(calls, [
      `${BASE}/api/alerts?status=open&limit=5&before=ab%2B%2F%3D%3F%26x%3D1`,
      `${BASE}/api/alerts`,
    ]);
  });

  it('returns the alerts and the cursor exactly as ingest sent it', async () => {
    const { poller, handlers } = setup();
    handlers.alerts = withCursor([wireAlert({ id: '9' })], 'eyJ0IjoiMjAyNi0xMC0xNiJ9');

    const page = await poller.alertsPage({ limit: 1 });

    assert.deepEqual(
      page.alerts.map((a) => a.id),
      ['9'],
    );
    assert.equal(page.next, 'eyJ0IjoiMjAyNi0xMC0xNiJ9');
  });

  it('has no next cursor on the last page, whether the header is absent or empty', async () => {
    const { poller, handlers } = setup();
    handlers.alerts = withCursor([wireAlert()], null);
    assert.equal((await poller.alertsPage()).next, null);
    handlers.alerts = withCursor([wireAlert()], '');
    assert.equal((await poller.alertsPage()).next, null);
  });

  it('turns ingest’s 400 into a refusal with its message, one string or several', async () => {
    const { poller, handlers } = setup();
    handlers.alerts = respond(
      { statusCode: 400, error: 'Bad Request', message: 'bad cursor' },
      400,
    );
    await assert.rejects(poller.alertsPage({ before: 'x' }), readError('refused', 'bad cursor'));

    handlers.alerts = respond(
      {
        statusCode: 400,
        error: 'Bad Request',
        message: ['limit must not be greater than 200', 'x'],
      },
      400,
    );
    await assert.rejects(
      poller.alertsPage({ limit: 500 }),
      readError('refused', 'limit must not be greater than 200; x'),
    );

    handlers.alerts = respond('<html>', 400);
    await assert.rejects(poller.alertsPage(), readError('refused', 'ingest refused the request'));
  });

  it('treats any other status as unreachable, with the status', async () => {
    const { poller, handlers } = setup();
    handlers.alerts = respond({}, 503);
    await assert.rejects(poller.alertsPage(), readError('unreachable', 'HTTP 503'));
  });

  it('says why when ingest does not answer, and when it answers too late', async () => {
    const { poller, handlers } = setup({ pageTimeoutMs: 10 });
    handlers.alerts = refused;
    await assert.rejects(poller.alertsPage(), readError('unreachable', 'ECONNREFUSED'));

    handlers.alerts = hang;
    await assert.rejects(poller.alertsPage(), readError('unreachable', 'no answer within 10 ms'));
  });

  it('refuses a reply that is not the documented shape, as a whole', async () => {
    const { poller, handlers } = setup();
    for (const body of ['not json', '{"alerts":[]}', JSON.stringify([wireAlert(), { id: 7 }])]) {
      handlers.alerts = respond(body);
      await assert.rejects(
        poller.alertsPage(),
        readError('unreachable', 'unexpected reply from /api/alerts'),
      );
    }
  });

  it('uses its own timeout, not the poll’s', async () => {
    // The poll would give up after 5 ms; a person paging 200 rows has longer.
    const { poller, handlers } = setup({ timeoutMs: 5, pageTimeoutMs: 1000 });
    handlers.alerts = () =>
      new Promise<Response>((resolve) =>
        setTimeout(() => resolve(new Response(JSON.stringify([wireAlert()]))), 30),
      );
    assert.equal((await poller.alertsPage()).alerts.length, 1);
  });

  it('changes no feed and emits nothing: it is not part of the poll', async () => {
    const { poller, handlers, seen } = setup();
    handlers.alerts = withCursor([wireAlert()], 'c');
    await poller.alertsPage();
    assert.equal(poller.alerts().stale, true);
    assert.deepEqual(poller.alerts().alerts, []);
    assert.equal(seen.alerts.length, 0);
    assert.equal(seen.observation.length, 0);
  });
});

describe('IngestPoller observedAlert', () => {
  it('gives what the observer tracked, and undefined for an alert it never saw', async () => {
    const { poller, handlers } = setup();
    handlers.alerts = respond([wireAlert({ id: '4' })]);
    await poller.pollOnce();

    assert.equal(poller.observedAlert('4')?.preexisting, true);
    assert.equal(poller.observedAlert('5'), undefined);
  });
});
