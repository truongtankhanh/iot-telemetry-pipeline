import { AlertsController } from '../alerts/alerts.controller';
import { DevicesController } from '../devices/devices.controller';
import { HealthController } from '../health/health.controller';
import { HTTP_CONTROLLERS } from '../http-controllers';
import { OpenApiModule } from './openapi.module';
import { renderOpenApiDocument } from './render-openapi';

/**
 * The OpenAPI document built the way `pnpm docs:openapi` builds it: from the real controllers, with
 * their dependencies replaced by empty stubs, so no database, broker or worker is involved.
 *
 * This runs through ts-jest, which does not apply the Swagger plugin that `nest build` applies, so it
 * checks the paths and the shape of the output, not schemas or descriptions taken from comments.
 */
describe('the OpenAPI document', () => {
  let text: string;
  const document = () =>
    JSON.parse(text) as {
      info: { title: string; version: string };
      paths: Record<string, Record<string, unknown>>;
    };

  beforeAll(async () => {
    text = await renderOpenApiDocument();
  });

  it('lists the routes of the API under the /api prefix, and nothing else', () => {
    expect(Object.keys(document().paths).sort()).toEqual([
      '/api/alerts',
      '/api/devices',
      '/api/devices/{id}/readings',
      '/api/health',
      '/api/ready',
    ]);
  });

  it('documents only GET: the API is read-only', () => {
    for (const operations of Object.values(document().paths)) {
      expect(Object.keys(operations)).toEqual(['get']);
    }
  });

  it('leaves out the Prometheus endpoint, wherever it is served', () => {
    const paths = Object.keys(document().paths);

    expect(paths).not.toContain('/metrics');
    expect(paths).not.toContain('/api/metrics');
  });

  it('carries the title and version of the service', () => {
    expect(document().info).toMatchObject({ title: 'IoT Telemetry Pipeline', version: '0.1.0' });
  });

  it('is JSON with two-space indentation and exactly one final newline', () => {
    expect(text.endsWith('}\n')).toBe(true);
    expect(JSON.stringify(JSON.parse(text), null, 2) + '\n').toBe(text);
  });

  it('is the same text every time, so a drift check can compare it byte for byte', async () => {
    await expect(renderOpenApiDocument()).resolves.toBe(text);
  });
});

interface Schema {
  $ref?: string;
  type?: string;
  items?: Schema;
  oneOf?: Schema[];
}
interface ApiResponse {
  description?: string;
  content?: Record<string, { schema?: Schema }>;
  headers?: Record<string, unknown>;
}

/** What the explicit decorators (`@ApiOkResponse`, `@ApiProperty`, …) put in the document: no plugin needed. */
describe('the responses the document describes', () => {
  let doc: {
    paths: Record<string, { get: { responses: Record<string, ApiResponse> } }>;
    components: { schemas: Record<string, unknown> };
  };

  beforeAll(async () => {
    doc = JSON.parse(await renderOpenApiDocument()) as typeof doc;
  });

  const response = (path: string, status: string) => doc.paths[path]?.get.responses[status];
  const schemaOf = (path: string, status: string) =>
    response(path, status)?.content?.['application/json']?.schema;
  const refName = (schema?: Schema) => schema?.$ref?.split('/').pop();

  it('has a schema for every response class', () => {
    expect(Object.keys(doc.components.schemas)).toEqual(
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

  it('answers each route with a described, typed 200', () => {
    expect(schemaOf('/api/devices', '200')).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/DeviceResponse' },
    });
    expect(refName(schemaOf('/api/health', '200'))).toBe('HealthResponse');
    expect(refName(schemaOf('/api/ready', '200'))).toBe('ReadyResponse');
    for (const path of Object.keys(doc.paths)) {
      expect(response(path, '200')?.description).toBeTruthy();
    }
  });

  it('answers readings with either the raw or the rollup response', () => {
    const options = schemaOf('/api/devices/{id}/readings', '200')?.oneOf ?? [];

    expect(options.map(refName).sort()).toEqual(['RawReadingsResponse', 'RollupReadingsResponse']);
  });

  it('answers alerts with an array of alerts, and says where the next page starts', () => {
    expect(schemaOf('/api/alerts', '200')).toMatchObject({
      type: 'array',
      items: { $ref: '#/components/schemas/AlertResponse' },
    });
    expect(response('/api/alerts', '200')?.headers).toHaveProperty('X-Next-Cursor');
  });

  it('documents the error answers with the shape the service really sends', () => {
    expect(refName(schemaOf('/api/devices/{id}/readings', '400'))).toBe('ErrorResponse');
    expect(refName(schemaOf('/api/devices/{id}/readings', '404'))).toBe('ErrorResponse');
    expect(refName(schemaOf('/api/alerts', '400'))).toBe('ErrorResponse');
    // Not the standard envelope: ready() throws its own object as the body.
    expect(refName(schemaOf('/api/ready', '503'))).toBe('NotReadyResponse');
  });
});

describe('the module the document is built from', () => {
  it('uses the controller list the service itself uses, so none can be missing from the document', () => {
    expect(Reflect.getMetadata('controllers', OpenApiModule)).toBe(HTTP_CONTROLLERS);
  });

  it('lists the devices, alerts and health controllers, in that order', () => {
    expect(HTTP_CONTROLLERS).toEqual([DevicesController, AlertsController, HealthController]);
  });

  it('stubs every dependency with an empty object, so nothing connects to anything', () => {
    const providers = Reflect.getMetadata('providers', OpenApiModule) as { useValue?: unknown }[];

    expect(providers.length).toBeGreaterThan(0);
    for (const provider of providers) expect(provider.useValue).toEqual({});
  });
});
