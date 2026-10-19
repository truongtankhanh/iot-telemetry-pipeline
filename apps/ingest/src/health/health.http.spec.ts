import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from '../configure-app';
import { Database } from '../database/database';
import { ALERT_SINK } from '../delivery/alert-sink';
import { Metrics } from '../metrics/metrics';
import { MqttConsumer } from '../telemetry/mqtt-consumer.service';
import { HealthController } from './health.controller';

/**
 * The probes and the scrape endpoint through the real application setup (`configureApp`), which the
 * controller spec bypasses. Every answer, including the `503`, carries a request id, and the bodies
 * are the ones the controller returns. The collaborators are stubs.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('the health and metrics endpoints (HTTP)', () => {
  let app: INestApplication | undefined;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue({ rows: [] });
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
          load: [() => ({ API_DOCS_ENABLED: false })],
        }),
      ],
      controllers: [HealthController],
      providers: [
        { provide: Database, useValue: { query } },
        { provide: MqttConsumer, useValue: { isConnected: true } },
        { provide: Metrics, useValue: { registry: { metrics: async () => '# no metrics\n' } } },
        { provide: ALERT_SINK, useValue: { name: 'none' } },
      ],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterEach(() => app?.close());

  const get = (path: string) => request(app!.getHttpServer()).get(path);

  it('GET /api/health answers 200 with a request id', async () => {
    const res = await get('/api/health').expect(200);

    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('GET /api/ready answers 200 with a request id', async () => {
    const res = await get('/api/ready').expect(200);

    expect(res.body).toEqual({ status: 'ready', database: 'up', broker: 'up', alertSink: 'none' });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('GET /api/ready answers 503 with a request id, and the body is not the error envelope', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));

    const res = await get('/api/ready').expect(503);

    expect(res.body).toEqual({
      status: 'not ready',
      database: 'down',
      broker: 'up',
      alertSink: 'none',
    });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('GET /metrics answers 200 with a request id, and echoes one the scraper sends', async () => {
    const plain = await get('/metrics').expect(200);
    const sent = await get('/metrics').set('X-Request-Id', 'scrape-1').expect(200);

    expect(plain.text).toBe('# no metrics\n');
    expect(plain.headers['x-request-id']).toMatch(UUID);
    expect(sent.headers['x-request-id']).toBe('scrape-1');
  });
});
