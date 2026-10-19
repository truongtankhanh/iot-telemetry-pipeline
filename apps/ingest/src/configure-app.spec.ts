import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from './configure-app';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function appWithDocs(enabled: boolean): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        isGlobal: true,
        load: [() => ({ API_DOCS_ENABLED: enabled })],
      }),
    ],
  }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}

describe('configureApp', () => {
  let app: INestApplication | undefined;
  afterEach(() => app?.close());

  it('serves the OpenAPI UI and document when API_DOCS_ENABLED is on', async () => {
    app = await appWithDocs(true);
    await request(app.getHttpServer()).get('/api/docs').expect(200);
    const document = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(document.body.info.title).toBe('IoT Telemetry Pipeline');
  });

  it('serves neither the UI nor the document when it is off', async () => {
    app = await appWithDocs(false);
    await request(app.getHttpServer()).get('/api/docs').expect(404);
    await request(app.getHttpServer()).get('/api/docs-json').expect(404);
  });

  it('puts a request id on a response that no handler produced', async () => {
    app = await appWithDocs(false);
    const res = await request(app.getHttpServer()).get('/api/nothing').expect(404);

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('answers with the request id the caller sent, when it is a valid one', async () => {
    app = await appWithDocs(false);
    const res = await request(app.getHttpServer())
      .get('/api/nothing')
      .set('X-Request-Id', 'caller-1')
      .expect(404);

    expect(res.headers['x-request-id']).toBe('caller-1');
  });
});
