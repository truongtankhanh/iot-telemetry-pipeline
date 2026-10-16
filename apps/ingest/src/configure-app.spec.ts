import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from './configure-app';

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
});
