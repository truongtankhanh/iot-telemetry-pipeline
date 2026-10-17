import { ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '../database/database';
import type { AlertSink } from '../delivery/alert-sink';
import type { Metrics } from '../metrics/metrics';
import type { MqttConsumer } from '../telemetry/mqtt-consumer.service';
import { HealthController } from './health.controller';

function controller({
  database = 'up',
  broker = 'up',
  sink = 'none',
}: { database?: 'up' | 'down'; broker?: 'up' | 'down'; sink?: string } = {}) {
  const db = {
    query:
      database === 'up'
        ? jest.fn().mockResolvedValue({ rows: [] })
        : jest.fn().mockRejectedValue(new Error('connection refused')),
  } as unknown as Database;
  const consumer = { isConnected: broker === 'up' } as unknown as MqttConsumer;
  return new HealthController(
    db,
    consumer,
    {} as unknown as Metrics,
    { name: sink } as unknown as AlertSink,
  );
}

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected readiness to fail');
    },
    (error: unknown) => error as ServiceUnavailableException,
  );

describe('HealthController.ready', () => {
  it('is ready without a command center, and says so', async () => {
    await expect(controller({ sink: 'none' }).ready()).resolves.toEqual({
      status: 'ready',
      database: 'up',
      broker: 'up',
      alertSink: 'none',
    });
  });

  it('names the command center sink when one is configured', async () => {
    await expect(controller({ sink: 'ops-command-center' }).ready()).resolves.toEqual({
      status: 'ready',
      database: 'up',
      broker: 'up',
      alertSink: 'ops-command-center',
    });
  });

  it('answers 503 with the sink name when the database is down', async () => {
    const error = await rejection(controller({ database: 'down' }).ready());

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual({
      status: 'not ready',
      database: 'down',
      broker: 'up',
      alertSink: 'none',
    });
  });

  it('answers 503 with the sink name when the broker is down', async () => {
    const error = await rejection(
      controller({ broker: 'down', sink: 'ops-command-center' }).ready(),
    );

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual({
      status: 'not ready',
      database: 'up',
      broker: 'down',
      alertSink: 'ops-command-center',
    });
  });
});
