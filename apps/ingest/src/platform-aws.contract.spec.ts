// First: the decorators in env.validation.ts need the Reflect metadata API before they are applied.
import 'reflect-metadata';
import { TELEMETRY_FILTER, withShareGroup } from '@itp/telemetry-contract';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Env, validateEnv } from './config/env.validation';
import { HealthController } from './health/health.controller';
import { Metrics } from './metrics/metrics';
import { mqttConnectOptions } from './telemetry/mqtt-options';

/**
 * The values platform-aws hard-codes about this service, checked against the real ones (V1-T07,
 * ADR-0010). Neither repository's own tests can see the other side, and a mismatch only shows up
 * deployed: a denied connection, a message nobody receives, an alarm that never fires.
 *
 * The other side is read from a snapshot of platform-aws `lib/stacks/telemetry.ts` in test/contract
 * (refresh: scripts/sync-platform-aws.sh). To check another copy, e.g. the sibling checkout:
 *   PLATFORM_AWS_TELEMETRY_PATH=../platform-aws/lib/stacks/telemetry.ts
 *
 * The snapshot is TypeScript read with regular expressions. That is deliberately crude: when
 * platform-aws restructures the file, the lookups below fail loudly and name what they could not
 * find, which is the signal to revisit this test.
 */
const STACK_PATH =
  process.env.PLATFORM_AWS_TELEMETRY_PATH ??
  join(__dirname, '../test/contract/platform-aws-telemetry.ts.txt');
const stack = readFileSync(STACK_PATH, 'utf8');

/** `const NAME = 'text'` or `const NAME = 123`, exported or not. */
function constant(name: string): string {
  const match = new RegExp(`const ${name} = (?:'([^']*)'|(\\d+));`).exec(stack);
  if (!match) throw new Error(`platform-aws no longer declares the constant ${name}`);
  return match[1] ?? match[2]!;
}

/** The keys of the object literal that follows `marker`, up to its closing brace. */
function keysAfter(marker: string): string[] {
  const start = stack.indexOf(marker);
  if (start < 0) throw new Error(`platform-aws no longer has "${marker}"`);
  const end = stack.indexOf('\n      },', start);
  return [...stack.slice(start, end).matchAll(/^ {8}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]!);
}

const defaults = validateEnv({ DATABASE_URL: 'postgres://localhost/telemetry' });

describe('platform-aws contract', () => {
  it('subscribes to the topic filter and share group the IoT policy grants', () => {
    expect(constant('TELEMETRY_TOPIC_FILTER')).toBe(TELEMETRY_FILTER);
    expect(constant('SHARE_GROUP')).toBe(defaults.MQTT_SHARE_GROUP);
    // The exact filter string this service subscribes with must be the policy's topicfilter.
    expect(withShareGroup(TELEMETRY_FILTER, defaults.MQTT_SHARE_GROUP)).toBe(
      `$share/${constant('SHARE_GROUP')}/${constant('TELEMETRY_TOPIC_FILTER')}`,
    );
  });

  it('connects with a client id the IoT policy allows', () => {
    expect(constant('INGEST_CLIENT_ID_PREFIX')).toBe(defaults.MQTT_CLIENT_ID_PREFIX);
    const { clientId } = mqttConnectOptions(defaults, 0, 'host-1');
    // Policy resource: client/<prefix>-*
    expect(clientId!.startsWith(`${constant('INGEST_CLIENT_ID_PREFIX')}-`)).toBe(true);
  });

  it('listens on the port and answers the health check platform-aws probes', () => {
    expect(Number(constant('INGEST_PORT'))).toBe(defaults.PORT);

    const probe = /http:\/\/127\.0\.0\.1:\$\{INGEST_PORT\}(\/\S+) >/.exec(stack);
    if (!probe) throw new Error('platform-aws no longer has an ECS health check on INGEST_PORT');
    // configureApp mounts everything but /metrics under /api.
    const route = Reflect.getMetadata('path', HealthController.prototype.health) as string;
    expect(probe[1]).toBe(`/api/${route}`);
  });

  it('uses the Keycloak client id this service documents', () => {
    const example = readFileSync(join(__dirname, '../.env.example'), 'utf8');
    expect(constant('PIPELINE_CLIENT_ID')).toBe(/^#? ?OCC_CLIENT_ID=(\S+)/m.exec(example)?.[1]);
  });

  it('sets only environment variables this service reads', () => {
    const known = Object.keys(new Env());
    // Guards the lookup itself: if class fields stop being enumerable this would pass vacuously.
    expect(known).toEqual(expect.arrayContaining(['DATABASE_URL', 'MQTT_SHARE_GROUP']));

    const set = [...keysAfter('environment: {'), ...keysAfter('secrets: {')];
    // Guards the lookup itself: finding no variables at all would make the check below vacuous.
    expect(set.length).toBeGreaterThan(0);
    // PGPASSWORD is read by node-postgres itself, not by this service's configuration.
    expect(set.filter((name) => name !== 'PGPASSWORD' && !known.includes(name))).toEqual([]);
  });

  it('exports every metric platform-aws selects, with the labels it splits them by', () => {
    const registry = new Metrics().registry;
    const names = [...new Set(stack.match(/telemetry_[a-z0-9_]+/g))];
    // Guards the lookup itself: finding no names at all would make the checks below vacuous.
    expect(names.length).toBeGreaterThan(0);

    // Lists the names platform-aws selects that this service no longer exports.
    expect(names.filter((name) => !registry.getSingleMetric(name))).toEqual([]);

    // dimensions: [['result']], metricNameSelectors: ['^telemetry_messages_total$']
    const declarations = stack.matchAll(
      /dimensions:\s*\[\[([^\]]*)\]\],\s*metricNameSelectors:\s*\[([^\]]*)\]/g,
    );
    for (const [, dimensions, selectors] of declarations) {
      const labels = [...dimensions!.matchAll(/'(\w+)'/g)].map((m) => m[1]);
      for (const [, name] of selectors!.matchAll(/\^(\w+)\$/g)) {
        const metric = registry.getSingleMetric(name!) as unknown as { labelNames?: string[] };
        for (const label of labels) expect(metric.labelNames ?? []).toContain(label);
      }
    }
  });
});
