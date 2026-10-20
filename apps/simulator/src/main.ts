import { connectAsync } from 'mqtt';
import { parseArgs } from 'node:util';
import { JsonFileDeviceSource } from './device-source.ts';
import { Engine } from './engine.ts';
import { SCENARIOS } from './scenarios.ts';
import { parseAnomaly } from './signals.ts';

const HELP = `Usage: node src/main.ts [options]

  --broker <url>        MQTT broker (default mqtt://localhost:1883)
  --registry <path>     devices.json to simulate (default ../ingest/config/devices.json)
  --interval <ms>       publish interval per device (default 2000)
  --anomaly <spec>      device:metric:value:startAt:duration, repeatable
                        e.g. dc-env-01:temperature_c:29.5:20:60
  --scenario <name>     preset anomalies: server-room-overheat | crowded-lecture
  --duration <s>        stop after this many seconds (default: run until Ctrl+C)
`;

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

const devices = await new JsonFileDeviceSource(values.registry).load();
const anomalies = [
  ...(values.scenario ? (SCENARIOS[values.scenario] ?? []) : []),
  ...values.anomaly,
].map(parseAnomaly);
if (values.scenario && !SCENARIOS[values.scenario])
  throw new Error(`Unknown scenario ${values.scenario}`);

const client = await connectAsync(values.broker, {
  protocolVersion: 5,
  clientId: `simulator-${process.pid}`,
});
const engine = new Engine({
  devices,
  publisher: { publish: (topic, payload, options) => client.publishAsync(topic, payload, options) },
  intervalMs: Number(values.interval),
  anomalies,
});
engine.on('tick-error', (error) => console.error(error.message));

console.log(`Simulating ${devices.length} devices → ${values.broker}, every ${values.interval} ms`);
for (const a of anomalies) {
  console.log(
    `  anomaly: ${a.deviceId} ${a.metric}=${a.value} from t+${a.startAt}s for ${a.duration}s`,
  );
}

const report = setInterval(() => console.log(`published ${engine.published} messages`), 10_000);

async function stop(): Promise<void> {
  engine.stop();
  clearInterval(report);
  await client.endAsync();
  console.log(`stopped after ${engine.published} messages`);
  process.exit(0);
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
if (values.duration) setTimeout(() => void stop(), Number(values.duration) * 1000);
// The first tick is awaited without a catch, as before: if it fails the process exits with the error.
await engine.start();
