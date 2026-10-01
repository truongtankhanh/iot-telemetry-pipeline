import { telemetryTopic, type TelemetryPayload } from '@itp/telemetry-contract';
import { connectAsync } from 'mqtt';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { type Anomaly, type DeviceSpec, parseAnomaly, sample } from './signals.ts';

const HELP = `Usage: node src/main.ts [options]

  --broker <url>        MQTT broker (default mqtt://localhost:1883)
  --registry <path>     devices.json to simulate (default ../ingest/config/devices.json)
  --interval <ms>       publish interval per device (default 2000)
  --anomaly <spec>      device:metric:value:startAt:duration, repeatable
                        e.g. dc-env-01:temperature_c:29.5:20:60
  --scenario <name>     preset anomalies: server-room-overheat | crowded-lecture
  --duration <s>        stop after this many seconds (default: run until Ctrl+C)
`;

const SCENARIOS: Record<string, string[]> = {
  // Overheats row A for a minute, then recovers: opens and clears "Server room temperature high".
  'server-room-overheat': ['dc-env-01:temperature_c:29.2:20:60'],
  'crowded-lecture': ['lha-air-01:co2_ppm:1450:20:90'],
};

const { values } = parseArgs({
  options: {
    broker: { type: 'string', default: process.env.MQTT_URL ?? 'mqtt://localhost:1883' },
    registry: {
      type: 'string',
      default: new URL('../../ingest/config/devices.json', import.meta.url).pathname,
    },
    interval: { type: 'string', default: '2000' },
    anomaly: { type: 'string', multiple: true, default: [] },
    scenario: { type: 'string' },
    duration: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const devices = (JSON.parse(readFileSync(values.registry, 'utf8')) as { devices: DeviceSpec[] })
  .devices;
const anomalies: Anomaly[] = [
  ...(values.scenario ? (SCENARIOS[values.scenario] ?? []) : []),
  ...values.anomaly,
].map(parseAnomaly);
if (values.scenario && !SCENARIOS[values.scenario])
  throw new Error(`Unknown scenario ${values.scenario}`);

const client = await connectAsync(values.broker, {
  protocolVersion: 5,
  clientId: `simulator-${process.pid}`,
});
const started = Date.now();
const seq = new Map<string, number>();
let published = 0;

console.log(`Simulating ${devices.length} devices → ${values.broker}, every ${values.interval} ms`);
for (const a of anomalies) {
  console.log(
    `  anomaly: ${a.deviceId} ${a.metric}=${a.value} from t+${a.startAt}s for ${a.duration}s`,
  );
}

async function tick(): Promise<void> {
  const now = new Date();
  const elapsed = (now.getTime() - started) / 1000;
  await Promise.all(
    devices.map((device) => {
      const next = (seq.get(device.id) ?? 0) + 1;
      seq.set(device.id, next);
      const payload: TelemetryPayload = {
        seq: next,
        ts: now.toISOString(),
        metrics: Object.fromEntries(
          device.metrics.map((m) => [m, sample(device, m, now, elapsed, anomalies)]),
        ),
      };
      published++;
      return client.publishAsync(
        telemetryTopic({ zoneCode: device.zoneCode, deviceId: device.id }),
        JSON.stringify(payload),
        { qos: 1 },
      );
    }),
  );
}

const timer = setInterval(
  () => void tick().catch((e: Error) => console.error(e.message)),
  Number(values.interval),
);
const report = setInterval(() => console.log(`published ${published} messages`), 10_000);

async function stop(): Promise<void> {
  clearInterval(timer);
  clearInterval(report);
  await client.endAsync();
  console.log(`stopped after ${published} messages`);
  process.exit(0);
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
if (values.duration) setTimeout(() => void stop(), Number(values.duration) * 1000);
await tick();
