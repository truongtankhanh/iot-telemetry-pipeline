import { connectAsync } from 'mqtt';
import { parseArgs } from 'node:util';
import { BrokerLink } from './broker-link.ts';
import { systemClock } from './clock.ts';
import { ControlConfigError, isLoopbackHost, resolveControlConfig } from './control-config.ts';
import { ControlServer } from './control-server.ts';
import { JsonFileDeviceSource } from './device-source.ts';
import { Engine } from './engine.ts';
import { IngestPoller } from './ingest-poller.ts';
import { loadRules } from './rules-source.ts';
import { toAnomalies } from './scenario-document.ts';
import { loadScenarioFolder, ScenarioLibrary } from './scenario-library.ts';
import { BUILT_IN_SCENARIOS } from './scenarios.ts';
import { type Anomaly, parseAnomaly } from './signals.ts';

const HELP = `Usage: node src/main.ts [options]

  --broker <url>        MQTT broker (default mqtt://localhost:1883)
  --registry <path>     devices.json to simulate (default ../ingest/config/devices.json)
  --rules <path>        rules.json that Studio draws the raise and clear lines from (default
                        RULES_FILE, else ../ingest/config/rules.json); a file that cannot be
                        read is reported, not fatal
  --interval <ms>       publish interval per device (default 2000)
  --anomaly <spec>      device:metric:value:startAt:duration, repeatable
                        e.g. dc-env-01:temperature_c:29.5:20:60
  --scenario <name>     play a scenario from the start: ${BUILT_IN_SCENARIOS.map((s) => s.name).join(' | ')},
                        or a custom one from the scenarios folder (read with the control server)
  --duration <s>        stop after this many seconds (default: run until Ctrl+C)

Control server (HTTP commands and an event stream; no authentication):
  --control-host <addr> listen address (default CONTROL_HOST, else 127.0.0.1; another
                        address needs CONTROL_ALLOW_NON_LOOPBACK=true)
  --control-port <port> listen port (default CONTROL_PORT, else 3200)
  --ingest-url <url>    ingest to read alerts, readiness and metrics from
                        (default INGEST_URL, else http://localhost:3100)
  --studio-dir <path>   built Studio UI to serve at / (default STUDIO_DIR, else
                        ../simulator-ui/dist; run pnpm --filter @itp/simulator-ui build)
  --scenarios-dir <path> folder of custom scenario files (*.json), read once at start
                        (default SCENARIOS_DIR, else ../scenarios; a missing folder means none)
  --no-control          run without the control server, as a plain publisher
`;

const { values } = parseArgs({
  options: {
    broker: { type: 'string', default: process.env.MQTT_URL ?? 'mqtt://localhost:1883' },
    registry: {
      type: 'string',
      default: new URL('../../ingest/config/devices.json', import.meta.url).pathname,
    },
    rules: { type: 'string' },
    interval: { type: 'string', default: '2000' },
    anomaly: { type: 'string', multiple: true, default: [] },
    scenario: { type: 'string' },
    duration: { type: 'string' },
    'control-host': { type: 'string' },
    'control-port': { type: 'string' },
    'ingest-url': { type: 'string' },
    'studio-dir': { type: 'string' },
    'scenarios-dir': { type: 'string' },
    'no-control': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const devices = await new JsonFileDeviceSource(values.registry).load();

// A refused or unusable control address stops the process here, before it connects or publishes.
function resolveControl() {
  try {
    return resolveControlConfig({
      env: process.env,
      flags: {
        controlHost: values['control-host'],
        controlPort: values['control-port'],
        ingestUrl: values['ingest-url'],
        studioDir: values['studio-dir'],
        scenariosDir: values['scenarios-dir'],
      },
    });
  } catch (error) {
    if (!(error instanceof ControlConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
const control = values['no-control'] ? undefined : resolveControl();

// The scenarios the simulator can play. The folder of custom ones is read only for the control server, which is
// what lists and runs them; a document that does not fit this registry is reported, not played.
const library = new ScenarioLibrary({
  builtIn: BUILT_IN_SCENARIOS,
  ...(control ? { folder: loadScenarioFolder(control.scenariosDir, { devices }) } : {}),
  devices,
});

function scenarioAnomalies(name: string): Anomaly[] {
  const entry = library.get(name);
  if (entry) return toAnomalies(entry.scenario);
  const unusable = library.rejected.find((rejected) => rejected.file === `built-in:${name}`);
  if (unusable) {
    throw new Error(`Scenario ${name} cannot be used with this registry: ${unusable.reason}`);
  }
  throw new Error(`Unknown scenario ${name}`);
}
const anomalies = [
  ...(values.scenario ? scenarioAnomalies(values.scenario) : []),
  ...values.anomaly.map(parseAnomaly),
];

// The rules are for Studio only: a missing or unusable file never stops the simulator, it is said once here
// and in the state, and Studio hides what depends on it.
const rulesPath =
  values.rules ??
  (process.env.RULES_FILE?.trim() ||
    new URL('../../ingest/config/rules.json', import.meta.url).pathname);
const rules = control ? loadRules(rulesPath) : undefined;

const client = await connectAsync(values.broker, {
  protocolVersion: 5,
  clientId: `simulator-${process.pid}`,
});
// What Studio shows of this connection: the control server reports it and announces a change.
const brokerLink = new BrokerLink(values.broker, client.connected);
client.on('connect', () => brokerLink.setConnected(true));
client.on('close', () => brokerLink.setConnected(false));
client.on('offline', () => brokerLink.setConnected(false));
client.on('end', () => brokerLink.setConnected(false));
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

const counts = library.counts();
console.log(
  control
    ? `Scenarios: ${counts.builtIn} built-in, ${counts.custom} custom from ${control.scenariosDir}`
    : `Scenarios: ${counts.builtIn} built-in (custom ones are read only with the control server)`,
);
for (const rejected of library.rejected) {
  console.log(`  not used: ${rejected.file}: ${rejected.reason}`);
}

// The port is bound before the first publish, so an unusable port ends the process with nothing sent.
let controlServer: ControlServer | undefined;
if (control) {
  controlServer = new ControlServer({
    engine,
    devices,
    library,
    poller: new IngestPoller({ baseUrl: control.ingestUrl, clock: systemClock }),
    broker: brokerLink,
    studioDir: control.studioDir,
    ...(rules ? { rules } : {}),
    config: control,
  });
  try {
    const { address, port, studio } = await controlServer.listen();
    const host = address.includes(':') ? `[${address}]` : address;
    console.log(`Control server on http://${host}:${port}, reading ingest at ${control.ingestUrl}`);
    console.log(
      studio
        ? `Studio UI: http://${host}:${port}/`
        : 'Studio UI: not built (run pnpm --filter @itp/simulator-ui build)',
    );
    console.log(
      rules?.available
        ? `Rules: ${rules.items.length} from ${rulesPath}`
        : `Rules: not available (${rules?.reason}); Studio hides what depends on them`,
    );
    if (!isLoopbackHost(control.host)) {
      console.log(
        `  warning: the control API has no authentication and listens on ${control.host}`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await client.endAsync();
    process.exit(1);
  }
}

const report = setInterval(() => console.log(`published ${engine.published} messages`), 10_000);

async function stop(): Promise<void> {
  engine.stop();
  await controlServer?.close();
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
