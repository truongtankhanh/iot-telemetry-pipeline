import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import os from 'node:os';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/configure-app';
import { DeliveryWorker } from '../../src/delivery/delivery.worker';
import { Metrics } from '../../src/metrics/metrics';
import { RulesService } from '../../src/rules/rules.service';
import { BatchWriter } from '../../src/telemetry/batch-writer.service';
import { MqttConsumer } from '../../src/telemetry/mqtt-consumer.service';

export interface Replica {
  name: string;
  app: INestApplication;
  metrics: Metrics;
  writer: BatchWriter;
  rules: RulesService;
  delivery: DeliveryWorker;
  consumer: MqttConsumer;
  /** Shuts the replica down the way a scale-down would: consumers end, the buffer drains. */
  stop(): Promise<void>;
}

/**
 * Boots one more copy of the service in this process, as a replica of the same shared-subscription
 * group, database and (fake) command center. Replicas share the process environment, so they have
 * the same configuration.
 *
 * MQTT client ids are `<prefix>-<hostname>-<pid>-<connection>`, and every replica in this process
 * has the same pid, so two of them would take each other's connections over at the broker. The
 * instance string is computed once, in `MqttConsumer.onApplicationBootstrap`, which `listen`
 * awaits: `os.hostname` is replaced for exactly that long. The prefix cannot be varied instead,
 * because `ConfigModule` validates `process.env` once, when `AppModule` is imported.
 */
export async function startReplica(name: string): Promise<Replica> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication());

  const hostname = jest.spyOn(os, 'hostname').mockReturnValue(`replica-${name}`);
  try {
    await app.listen(0);
  } finally {
    hostname.mockRestore();
  }

  let stopped = false;
  return {
    name,
    app,
    metrics: app.get(Metrics),
    writer: app.get(BatchWriter),
    rules: app.get(RulesService),
    delivery: app.get(DeliveryWorker),
    consumer: app.get(MqttConsumer),
    // Idempotent: a case may stop a replica, and afterAll stops every replica again.
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await app.close();
    },
  };
}
