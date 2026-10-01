import { Controller, Get, Header, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Database } from '../database/database';
import { Metrics } from '../metrics/metrics';
import { MqttConsumer } from '../telemetry/mqtt-consumer.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly consumer: MqttConsumer,
    private readonly metrics: Metrics,
  ) {}

  /** Liveness: the process is up. Kubernetes restarts the pod if this fails. */
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /** Readiness: database reachable and subscribed to the broker. */
  @Get('ready')
  async ready() {
    const database = await this.db
      .query('SELECT 1')
      .then(() => 'up')
      .catch(() => 'down');
    const broker = this.consumer.isConnected ? 'up' : 'down';
    if (database !== 'up' || broker !== 'up') {
      throw new ServiceUnavailableException({ status: 'not ready', database, broker });
    }
    return { status: 'ready', database, broker };
  }

  /** Prometheus scrape endpoint. */
  @Get('metrics')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
