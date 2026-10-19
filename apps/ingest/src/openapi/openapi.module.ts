import { Module } from '@nestjs/common';
import { Database } from '../database/database';
import { ALERT_SINK } from '../delivery/alert-sink';
import { DevicesService } from '../devices/devices.service';
import { HTTP_CONTROLLERS } from '../http-controllers';
import { Metrics } from '../metrics/metrics';
import { MqttConsumer } from '../telemetry/mqtt-consumer.service';

/**
 * What the OpenAPI document is built from: the service's own controllers, with everything they
 * inject replaced by an empty object. Building a document only reads the controllers' metadata, so
 * no stub is ever called, and nothing opens a database pool, connects to a broker or starts a worker.
 *
 * A controller that gains a dependency makes the generator fail to boot with Nest's own message
 * ("Nest can't resolve dependencies of …"): that is the signal to add its stub here.
 */
@Module({
  controllers: HTTP_CONTROLLERS,
  providers: [
    { provide: Database, useValue: {} },
    { provide: DevicesService, useValue: {} },
    { provide: MqttConsumer, useValue: {} },
    { provide: Metrics, useValue: {} },
    { provide: ALERT_SINK, useValue: {} },
  ],
})
export class OpenApiModule {}
