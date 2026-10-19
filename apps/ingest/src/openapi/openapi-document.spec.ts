import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The committed `docs/openapi.json`, which `pnpm docs:openapi` generates from the **built** code.
 * Reading the file is the way to assert what the Swagger plugin derives (query parameters, bounds,
 * comments): ts-jest does not apply the plugin, but the build does, and `openapi:check` keeps the file
 * equal to what the build produces. What the explicit decorators describe is asserted in
 * `openapi.spec.ts`, from a document built in the test.
 */

interface Schema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  nullable?: boolean;
  items?: Schema;
  oneOf?: Schema[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  default?: unknown;
  properties?: Record<string, Schema>;
}
interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: Schema;
}
interface ApiResponse {
  description?: string;
  content?: Record<string, { schema?: Schema }>;
  headers?: Record<string, unknown>;
}
interface Operation {
  parameters: Parameter[];
  responses: Record<string, ApiResponse>;
}
interface Document {
  paths: Record<string, { get: Operation }>;
  components: { schemas: Record<string, Schema> };
}

const document = JSON.parse(
  readFileSync(join(__dirname, '../../../../docs/openapi.json'), 'utf8'),
) as Document;

const READINGS = '/api/devices/{id}/readings';
const operation = (path: string) => document.paths[path]!.get;
const parameter = (path: string, name: string) =>
  operation(path).parameters.find((p) => p.name === name);
const refName = (schema?: Schema) => schema?.$ref?.split('/').pop();
const schema = (name: string) => document.components.schemas[name];
const successSchema = (path: string) =>
  operation(path).responses['200']?.content?.['application/json']?.schema;

/** A schema that points at, or is made of, schemas that exist in `components`. */
function resolves(s?: Schema): boolean {
  if (!s) return false;
  if (s.$ref) return refName(s)! in document.components.schemas;
  if (s.type === 'array') return resolves(s.items);
  if (s.oneOf) return s.oneOf.every(resolves);
  return false;
}

describe('docs/openapi.json: the query parameters', () => {
  it('lists the path and query parameters of the readings route', () => {
    expect(parameter(READINGS, 'id')).toMatchObject({ in: 'path', required: true });
    expect(parameter(READINGS, 'metric')).toMatchObject({ in: 'query', required: true });
    for (const name of ['from', 'to', 'resolution']) {
      expect(parameter(READINGS, name)).toMatchObject({ in: 'query' });
    }
  });

  it('gives the metric and the resolution their allowed values', () => {
    expect(parameter(READINGS, 'metric')?.schema?.enum).toEqual([
      'temperature_c',
      'humidity_pct',
      'co2_ppm',
      'power_kw',
    ]);
    expect(parameter(READINGS, 'resolution')?.schema).toMatchObject({
      enum: ['raw', '1m'],
      default: '1m',
    });
  });

  it('does not require the parameters that have a default', () => {
    expect(parameter(READINGS, 'resolution')?.required).toBe(false);
    expect(parameter('/api/alerts', 'limit')?.required).toBe(false);
  });

  it('reads from and to as date-times', () => {
    for (const name of ['from', 'to']) {
      expect(parameter(READINGS, name)?.schema).toMatchObject({
        type: 'string',
        format: 'date-time',
      });
    }
  });

  it('lists the query parameters of the alerts route, with their bounds', () => {
    expect(parameter('/api/alerts', 'status')?.schema?.enum).toEqual(['open', 'cleared']);
    expect(parameter('/api/alerts', 'limit')?.schema).toMatchObject({ minimum: 1, maximum: 200 });
    expect(parameter('/api/alerts', 'before')?.schema).toMatchObject({ maxLength: 200 });
  });
});

describe('docs/openapi.json: the responses', () => {
  it('gives every route a described success response whose schema exists', () => {
    for (const path of Object.keys(document.paths)) {
      expect(operation(path).responses['200']?.description).toBeTruthy();
      expect(resolves(successSchema(path))).toBe(true);
    }
  });

  it('has a schema for every response class', () => {
    expect(Object.keys(document.components.schemas).sort()).toEqual(
      expect.arrayContaining([
        'AlertResponse',
        'DeviceResponse',
        'ErrorResponse',
        'HealthResponse',
        'NotReadyResponse',
        'RawReading',
        'RawReadingsResponse',
        'ReadyResponse',
        'RollupPoint',
        'RollupReadingsResponse',
      ]),
    );
  });

  it('answers readings with either the raw or the rollup response', () => {
    expect((successSchema(READINGS)?.oneOf ?? []).map(refName).sort()).toEqual([
      'RawReadingsResponse',
      'RollupReadingsResponse',
    ]);
  });

  it('declares the header that carries the next page of alerts', () => {
    expect(operation('/api/alerts').responses['200']?.headers).toHaveProperty('X-Next-Cursor');
  });

  it('documents the error answers', () => {
    const error = (path: string, status: string) =>
      refName(operation(path).responses[status]?.content?.['application/json']?.schema);

    expect(error(READINGS, '400')).toBe('ErrorResponse');
    expect(error(READINGS, '404')).toBe('ErrorResponse');
    expect(error('/api/alerts', '400')).toBe('ErrorResponse');
    expect(error('/api/ready', '503')).toBe('NotReadyResponse');
  });
});

describe('docs/openapi.json: the shape of an alert and of a device', () => {
  it('returns ids as strings, because they are bigint in PostgreSQL', () => {
    expect(schema('AlertResponse')?.properties?.id?.type).toBe('string');
  });

  it.each([
    ['AlertResponse', 'clearedAt'],
    ['AlertResponse', 'clearedValue'],
    ['AlertResponse', 'externalRef'],
    ['AlertResponse', 'deliveryStatus'],
    ['AlertResponse', 'deliveryAttempts'],
    ['AlertResponse', 'deliveryError'],
    ['DeviceResponse', 'lastSeen'],
    ['RawReadingsResponse', 'nextFrom'],
  ])('marks %s.%s as nullable', (name, property) => {
    expect(schema(name)?.properties?.[property]?.nullable).toBe(true);
  });
});
