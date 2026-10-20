/**
 * Fakes shared by the tests of the control server. Not a `*.test.ts`, so `node --test src/*.test.ts`
 * does not run it; the engine's own tests keep their local fakes and are not touched.
 */
import { ManualClock } from './clock.ts';
import { Engine, type EngineOptions, type Publisher } from './engine.ts';
import type { FetchLike } from './ingest-poller.ts';
import { seededRandom } from './random.ts';
import type { DeviceSpec } from './signals.ts';

/** 12:00 on campus. */
export const T0 = Date.parse('2026-10-01T05:00:00Z');

export const DEVICES: DeviceSpec[] = [
  {
    id: 'dc-env-01',
    kind: 'server_room',
    zoneCode: 'BLD-DC',
    metrics: ['temperature_c', 'humidity_pct'],
  },
  {
    id: 'dc-env-02',
    kind: 'server_room',
    zoneCode: 'BLD-DC',
    metrics: ['temperature_c', 'humidity_pct'],
  },
  {
    id: 'lib-air-01',
    kind: 'indoor_air',
    zoneCode: 'BLD-LIB',
    metrics: ['co2_ppm', 'temperature_c', 'humidity_pct'],
  },
];

export class FakePublisher implements Publisher {
  readonly sent: { topic: string; payload: string }[] = [];

  async publish(topic: string, payload: string): Promise<void> {
    this.sent.push({ topic, payload });
  }
}

/** An engine in deterministic mode: a manual clock, a seeded random source, a fake publisher. */
export function setupEngine(options: Partial<EngineOptions> = {}) {
  const clock = new ManualClock(T0);
  const publisher = new FakePublisher();
  const engine = new Engine({
    devices: DEVICES,
    publisher,
    clock,
    intervalMs: 2000,
    random: seededRandom(20261020),
    ...options,
  });
  return { engine, clock, publisher };
}

export const READY_BODY = {
  status: 'ready',
  database: 'up',
  broker: 'up',
  alertSink: 'ops-command-center',
};

/**
 * A fake ingest for the poller: reachable or not, with the alerts and metrics it is told to return.
 * `GET /api/alerts` honours `status` and `limit` like ingest does, answers `X-Next-Cursor` with `nextCursor` when
 * one is set, and records every query it was sent; `alertsReply` replaces the whole answer (an error, say).
 */
export class FakeIngest {
  up = true;
  alerts: unknown[] = [];
  metrics = 'telemetry_sequence_gaps_total 0\n';
  requests = 0;
  nextCursor: string | null = null;
  alertsReply: { status: number; body: unknown } | undefined;
  readonly alertQueries: URLSearchParams[] = [];

  readonly fetch: FetchLike = async (url) => {
    this.requests++;
    if (!this.up) {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3100'), {
          code: 'ECONNREFUSED',
        }),
      });
    }
    const path = new URL(url).pathname;
    if (path === '/api/ready') return new Response(JSON.stringify(READY_BODY));
    if (path === '/api/alerts') return this.alertsResponse(new URL(url).searchParams);
    return new Response(this.metrics);
  };

  private alertsResponse(query: URLSearchParams): Response {
    this.alertQueries.push(query);
    if (this.alertsReply) {
      return new Response(JSON.stringify(this.alertsReply.body), {
        status: this.alertsReply.status,
      });
    }
    const status = query.get('status');
    const limit = query.has('limit') ? Number(query.get('limit')) : this.alerts.length;
    const rows = this.alerts
      .filter((alert) => status === null || (alert as { status?: string }).status === status)
      .slice(0, limit);
    return new Response(JSON.stringify(rows), {
      ...(this.nextCursor === null ? {} : { headers: { 'X-Next-Cursor': this.nextCursor } }),
    });
  }
}
