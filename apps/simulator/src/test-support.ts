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

/** A fake ingest for the poller: reachable or not, with the alerts and metrics it is told to return. */
export class FakeIngest {
  up = true;
  alerts: unknown[] = [];
  metrics = 'telemetry_sequence_gaps_total 0\n';
  requests = 0;

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
    if (path === '/api/alerts') return new Response(JSON.stringify(this.alerts));
    return new Response(this.metrics);
  };
}
