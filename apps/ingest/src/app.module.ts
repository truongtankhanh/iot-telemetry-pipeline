import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { type Env, validateEnv } from './config/env.validation';
import { Database } from './database/database';
import { ALERT_SINK } from './delivery/alert-sink';
import { DeliveryWorker } from './delivery/delivery.worker';
import { ClientCredentials } from './delivery/client-credentials';
import { NoopSink, OpsCommandCenterSink } from './delivery/ops-command-center.sink';
import { DevicesService } from './devices/devices.service';
import { HTTP_CONTROLLERS } from './http-controllers';
import { PartitionMaintenance } from './maintenance/partition-maintenance.service';
import { Metrics } from './metrics/metrics';
import { RulesService } from './rules/rules.service';
import { BatchWriter } from './telemetry/batch-writer.service';
import { MqttConsumer } from './telemetry/mqtt-consumer.service';

/** Infrastructure every feature module depends on. Initialised first, so migrations run first. */
@Global()
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv })],
  providers: [Database, Metrics],
  exports: [Database, Metrics],
})
export class CoreModule {}

/** Partitions must exist before the first reading arrives. */
@Module({
  imports: [CoreModule],
  providers: [PartitionMaintenance],
  exports: [PartitionMaintenance],
})
export class MaintenanceModule {}

@Module({
  imports: [CoreModule, MaintenanceModule],
  controllers: HTTP_CONTROLLERS,
  providers: [
    DevicesService,
    RulesService,
    BatchWriter,
    MqttConsumer,
    DeliveryWorker,
    {
      provide: ALERT_SINK,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('OCC_API_URL', { infer: true });
        if (!url) return new NoopSink();
        const tokenUrl = config.get('OCC_TOKEN_URL', { infer: true });
        const tokens = tokenUrl
          ? new ClientCredentials(
              tokenUrl,
              config.get('OCC_CLIENT_ID', { infer: true })!,
              config.get('OCC_CLIENT_SECRET', { infer: true })!,
            )
          : undefined;
        return new OpsCommandCenterSink(url, fetch, tokens);
      },
    },
  ],
  exports: [MqttConsumer, BatchWriter, DeliveryWorker, RulesService, DevicesService],
})
export class AppModule {}
