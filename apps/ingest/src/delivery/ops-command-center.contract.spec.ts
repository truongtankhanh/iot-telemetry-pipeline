import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AlertForDelivery } from './alert-sink';
import { idempotencyKey, OpsCommandCenterSink } from './ops-command-center.sink';

/**
 * Contract check against the command center's published OpenAPI document (V1-T06, ADR-0009).
 *
 * The sink is driven for real; what it sends is checked against the document, and so is what it
 * reads back. The e2e suite cannot do this: it talks to a fake written in this repository.
 *
 * The document is the snapshot in test/contract (refresh: scripts/sync-occ-openapi.sh). To check
 * against another copy, e.g. the sibling checkout or a branch under review:
 *   OCC_OPENAPI_PATH=../ops-command-center/docs/api/openapi.json
 */
const SPEC_PATH =
  process.env.OCC_OPENAPI_PATH ?? join(__dirname, '../../test/contract/occ-openapi.json');
const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApi;
const BASE_URL = 'http://occ/api';

interface OpenApi {
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, { type: string; scheme?: string }> };
}
interface Operation {
  parameters?: { name: string; in: string; schema: object }[];
  requestBody?: { content: Record<string, { schema: object }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
  security?: Record<string, string[]>[];
}
interface Schema {
  $ref?: string;
  type?: string;
  items?: Schema;
  required?: string[];
  properties?: Record<string, Schema>;
}

const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
ajv.addSchema(spec, 'occ');

const ZONE_ID = '3f2b8c1e-5d4a-4c1b-9a77-0e8d6f4b2a10';
const INCIDENT_ID = '9b1d3c5e-7f20-4a8b-8c64-1d2e3f4a5b6c';

const pointer = (...parts: string[]) =>
  `occ#/${parts.map((p) => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;

/** The documented operation behind a request, or a failure that names what disappeared. */
function operationFor(method: string, url: string): { path: string; operation: Operation } {
  const pathname = new URL(url).pathname;
  for (const [path, operations] of Object.entries(spec.paths)) {
    const pattern = new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`);
    const operation = operations[method.toLowerCase()];
    if (pattern.test(pathname) && operation) return { path, operation };
  }
  throw new Error(`${method} ${pathname} is not documented by the command center`);
}

function validate(pointerToSchema: string, data: unknown): string[] {
  const check = ajv.compile({ $ref: pointerToSchema });
  return check(data) ? [] : (check.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

/** Follows a `$ref` inside the document. */
function deref(schema: Schema): Schema {
  if (!schema.$ref) return schema;
  return schema.$ref
    .replace(/^#\//, '')
    .split('/')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], spec) as Schema;
}

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function recordingSink(reply: (call: Call) => unknown, status = 200) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method!,
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);
    return new Response(JSON.stringify(reply(call)), { status });
  }) as typeof fetch;
  const tokens = { token: async () => 'test-token', invalidate: () => undefined };
  return { calls, sink: new OpsCommandCenterSink(BASE_URL, fetchFn, tokens) };
}

const rules = (
  JSON.parse(readFileSync(join(__dirname, '../../config/rules.json'), 'utf8')) as {
    rules: { id: string; metric: string; severity: string; incidentType: string; title: string }[];
  }
).rules;

const alertFor = (rule: (typeof rules)[number], overrides: Partial<AlertForDelivery> = {}) =>
  ({
    id: '7',
    deviceId: 'dc-env-01',
    deviceName: 'Data center — row A',
    zoneCode: 'BLD-DC',
    ruleId: rule.id,
    metric: rule.metric,
    severity: rule.severity,
    title: rule.title,
    incidentType: rule.incidentType,
    openedAt: new Date('2026-10-01T08:00:00Z'),
    openedValue: 28.4,
    clearedAt: new Date('2026-10-01T08:10:00Z'),
    clearedValue: 24.9,
    externalRef: INCIDENT_ID,
    ...overrides,
  }) satisfies AlertForDelivery;

describe('ops-command-center contract', () => {
  it('authenticates the way the document says: an HTTP bearer scheme on every call we make', () => {
    const calls = [
      operationFor('GET', `${BASE_URL}/zones`),
      operationFor('POST', `${BASE_URL}/incidents`),
      operationFor('POST', `${BASE_URL}/incidents/${INCIDENT_ID}/resolve`),
    ];
    for (const { operation } of calls) {
      const schemes = (operation.security ?? []).flatMap((requirement) => Object.keys(requirement));
      expect(schemes.length).toBeGreaterThan(0);
      for (const name of schemes) {
        expect(spec.components.securitySchemes[name]).toMatchObject({
          type: 'http',
          scheme: 'bearer',
        });
      }
    }
  });

  it('lists zones with GET /zones and reads their id and code', async () => {
    const { calls, sink } = recordingSink((call) =>
      call.url.endsWith('/zones') ? [{ id: ZONE_ID, code: 'BLD-DC' }] : { id: INCIDENT_ID },
    );
    await sink.opened(alertFor(rules[0]!));

    const zonesCall = calls[0]!;
    expect(zonesCall.headers.Authorization).toBe('Bearer test-token');
    const { path, operation } = operationFor(zonesCall.method, zonesCall.url);
    expect(path).toBe('/api/zones');

    const list = deref(operation.responses['200']!.content!['application/json']!.schema);
    const zone = deref(list.items!);
    for (const field of ['id', 'code']) {
      expect(zone.required).toContain(field);
      expect(zone.properties![field]!.type).toBe('string');
    }
  });

  it.each(rules.map((rule) => [rule.id, rule] as const))(
    'creates an incident for rule %s with a body, a key and a response the document allows',
    async (_id, rule) => {
      const { calls, sink } = recordingSink((call) =>
        call.url.endsWith('/zones') ? [{ id: ZONE_ID, code: 'BLD-DC' }] : { id: INCIDENT_ID },
      );
      await expect(sink.opened(alertFor(rule))).resolves.toBe(INCIDENT_ID);

      const create = calls.find((c) => c.method === 'POST')!;
      const { path, operation } = operationFor(create.method, create.url);
      expect(path).toBe('/api/incidents');
      expect(
        validate(
          pointer('paths', path, 'post', 'requestBody', 'content', 'application/json', 'schema'),
          create.body,
        ),
      ).toEqual([]);

      // The retry-safety the outbox relies on (ADR-0005): the header must exist and accept our key.
      const index = operation.parameters!.findIndex(
        (p) => p.in === 'header' && p.name.toLowerCase() === 'idempotency-key',
      );
      expect(index).toBeGreaterThanOrEqual(0);
      expect(
        validate(
          pointer('paths', path, 'post', 'parameters', String(index), 'schema'),
          create.headers['Idempotency-Key'],
        ),
      ).toEqual([]);
      expect(create.headers['Idempotency-Key']).toBe(idempotencyKey({ id: '7' }));

      // What we read back: the id of the incident.
      const created = deref(
        (operation.responses['201'] ?? operation.responses['200']!).content!['application/json']!
          .schema,
      );
      expect(created.required).toContain('id');
      expect(created.properties!.id!.type).toBe('string');
    },
  );

  it('resolves with POST /incidents/{id}/resolve and a body the document allows', async () => {
    const { calls, sink } = recordingSink(() => ({ id: INCIDENT_ID }));
    await sink.cleared(alertFor(rules[0]!));

    const resolve = calls[0]!;
    const { path, operation } = operationFor(resolve.method, resolve.url);
    expect(path).toBe('/api/incidents/{id}/resolve');
    expect(
      validate(
        pointer('paths', path, 'post', 'requestBody', 'content', 'application/json', 'schema'),
        resolve.body,
      ),
    ).toEqual([]);

    const parameter = operation.parameters!.findIndex((p) => p.in === 'path' && p.name === 'id');
    expect(
      validate(
        pointer('paths', path, 'post', 'parameters', String(parameter), 'schema'),
        INCIDENT_ID,
      ),
    ).toEqual([]);
    // Treated as success by the sink: an operator got there first.
    expect(Object.keys(operation.responses)).toContain('409');
  });
});
