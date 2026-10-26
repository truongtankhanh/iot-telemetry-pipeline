import { parseArgs } from 'node:util';
import {
  connectBenchIo,
  DEFAULT_TIMEOUT_S,
  resolveDatabaseUrl,
  runBenchmark,
} from './bench-run.ts';
import { JsonFileDeviceSource } from './device-source.ts';

/**
 * End-to-end throughput: publishes N messages as fast as the broker accepts them, then waits until
 * every reading is in PostgreSQL. Measures the whole path — broker, ingest, batch writes, rollups,
 * rule evaluation — not just publishing. The loop itself is `bench-run.ts`, shared with Studio.
 */

const { values } = parseArgs({
  options: {
    broker: { type: 'string', default: process.env.MQTT_URL ?? 'mqtt://localhost:1883' },
    database: { type: 'string' },
    registry: {
      type: 'string',
      default: new URL('../../ingest/config/devices.json', import.meta.url).pathname,
    },
    messages: { type: 'string', default: '50000' },
    timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_S) },
    // One JSON line on stdout instead of the table, for scripts (deploy/bench/run-baseline.sh).
    json: { type: 'boolean', default: false },
  },
});
// Progress text goes to stderr with --json, so stdout carries exactly the result line.
const log = values.json ? console.error : console.log;

const devices = await new JsonFileDeviceSource(values.registry).load();
const connection = await connectBenchIo({
  broker: values.broker,
  database: resolveDatabaseUrl({ flag: values.database, env: process.env }),
});
const { outcome, result } = await runBenchmark({
  devices,
  messages: Number(values.messages),
  timeoutS: Number(values.timeout),
  io: connection,
  log,
}).finally(() => connection.close());

const complete = outcome === 'completed';
if (values.json) {
  // Exit only once the line is written: a pipe may not be flushed when the process ends.
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(complete ? 0 : 1));
} else {
  const count = (n: number) => n.toLocaleString('en-US');
  console.table({
    'messages published': result.messages,
    'readings expected': result.readingsExpected,
    'readings stored': result.readingsStored,
    'publish time (s)': result.publishSeconds.toFixed(2),
    'end-to-end time (s)': result.endToEndSeconds.toFixed(2),
    'messages/s end-to-end': count(result.messagesPerSecond),
    'readings/s end-to-end': count(result.readingsPerSecond),
    machine: `${result.vcpu} vCPU, Node ${result.node}`,
  });
  process.exit(complete ? 0 : 1);
}
