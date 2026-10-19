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
