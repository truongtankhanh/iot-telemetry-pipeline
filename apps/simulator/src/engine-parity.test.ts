import { type TelemetryPayload, telemetryTopic } from '@itp/telemetry-contract';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { ManualClock } from './clock.ts';
import { JsonFileDeviceSource } from './device-source.ts';
import { Engine, type Publisher } from './engine.ts';
import { seededRandom } from './random.ts';
import { toAnomalies, toAnomalyFlag } from './scenario-document.ts';
import { BUILT_IN_SCENARIOS } from './scenarios.ts';
import { type Anomaly, type DeviceSpec, parseAnomaly, sample } from './signals.ts';

/**
 * SIM-02 acceptance: the engine publishes what the loop of `main.ts` published before it was
 * extracted. That loop is reproduced below, line for line, with the clock and the random source
 * injected; the engine must produce the same topics and payload strings, in the same order.
 */

const registry = new URL('../../ingest/config/devices.json', import.meta.url).pathname;
const START = Date.parse('2026-10-01T05:00:00Z'); // 12:00 on campus
const INTERVAL_MS = 2000;
const TICKS = 51; // 0 s to 100 s: covers the 20 s to 80 s window of server-room-overheat
const SEED = 20261020;

interface Message {
  topic: string;
  payload: string;
}

/** The `tick()` of the old `main.ts`, run `ticks` times. */
function oldLoop(
  devices: DeviceSpec[],
  anomalies: Anomaly[],
  random: () => number,
  ticks: number,
): Message[] {
  const seq = new Map<string, number>();
  const messages: Message[] = [];
  for (let i = 0; i < ticks; i++) {
    const now = new Date(START + i * INTERVAL_MS);
    const elapsed = (now.getTime() - START) / 1000;
    for (const device of devices) {
      const next = (seq.get(device.id) ?? 0) + 1;
      seq.set(device.id, next);
      const payload: TelemetryPayload = {
        seq: next,
        ts: now.toISOString(),
        metrics: Object.fromEntries(
          device.metrics.map((m) => [m, sample(device, m, now, elapsed, anomalies, random)]),
        ),
      };
      messages.push({
        topic: telemetryTopic({ zoneCode: device.zoneCode, deviceId: device.id }),
        payload: JSON.stringify(payload),
      });
    }
  }
  return messages;
}

async function runEngine(devices: DeviceSpec[], anomalies: Anomaly[]): Promise<Message[]> {
  const messages: Message[] = [];
  const publisher: Publisher = {
    async publish(topic, payload) {
      messages.push({ topic, payload });
    },
  };
  const engine = new Engine({
    devices,
    publisher,
    clock: new ManualClock(START),
    random: seededRandom(SEED),
    intervalMs: INTERVAL_MS,
    anomalies,
  });
  await engine.start();
  for (let i = 1; i < TICKS; i++) await engine.step();
  engine.stop();
  return messages;
}

describe('Engine against the loop it replaced', () => {
  let devices: DeviceSpec[];
  before(async () => {
    devices = await new JsonFileDeviceSource(registry).load();
  });

  const cases: [string, Anomaly[]][] = [
    ...BUILT_IN_SCENARIOS.map((scenario): [string, Anomaly[]] => [
      scenario.name,
      toAnomalies(scenario),
    ]),
    ['no scenario', []],
    [
      'two anomalies at once',
      ['dc-env-02:humidity_pct:80:10:30', 'lib-air-01:co2_ppm:1200:40:20'].map(parseAnomaly),
    ],
  ];

  for (const [name, anomalies] of cases) {
    it(`publishes the same messages for ${name}`, async () => {
      const expected = oldLoop(devices, anomalies, seededRandom(SEED), TICKS);
      const actual = await runEngine(devices, anomalies);

      assert.equal(actual.length, devices.length * TICKS);
      assert.deepEqual(actual, expected);
    });
  }

  it('holds server-room-overheat at the anomaly value from 20 s to 80 s, and only then', async () => {
    const overheat = BUILT_IN_SCENARIOS.find(
      (scenario) => scenario.name === 'server-room-overheat',
    );
    const anomalies = toAnomalies(overheat!);

    const messages = await runEngine(devices, anomalies);

    const row = messages
      .filter((m) => m.topic === 'campus/BLD-DC/dc-env-01/telemetry')
      .map((m) => JSON.parse(m.payload) as TelemetryPayload);
    assert.equal(row.length, TICKS);
    row.forEach((reading, i) => {
      const seconds = i * (INTERVAL_MS / 1000);
      const temperature = reading.metrics.temperature_c!;
      if (seconds >= 20 && seconds < 80) {
        assert.ok(temperature >= 29.1 && temperature <= 29.3, `${seconds} s: ${temperature}`);
      } else {
        assert.ok(temperature >= 22.2 && temperature <= 22.8, `${seconds} s: ${temperature}`);
      }
    });
  });

  it('has a --anomaly flag for each built-in that gives back the same anomalies', () => {
    for (const scenario of BUILT_IN_SCENARIOS) {
      const flags = scenario.anomalies.map(toAnomalyFlag);
      assert.ok(
        flags.every((flag) => flag !== undefined),
        scenario.name,
      );
      assert.deepEqual(
        flags.map((flag) => parseAnomaly(flag!)),
        scenario.anomalies,
      );
    }
  });
});
