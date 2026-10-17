import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { Database } from '../database/database';
import { ALERT_SINK, type AlertSink } from '../delivery/alert-sink';
import { Metrics } from '../metrics/metrics';
import { MqttConsumer } from '../telemetry/mqtt-consumer.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly consumer: MqttConsumer,
    private readonly metrics: Metrics,
    @Inject(ALERT_SINK) private readonly sink: AlertSink,
  ) {}

  /** Liveness: the process is up. Kubernetes restarts the pod if this fails. */
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  /**
   * Readiness: database reachable and subscribed to the broker. `alertSink` is reported for
   * information only: a service without a command center (`none`) is still ready.
   */
  @Get('ready')
  async ready() {
    const database = await this.db
      .query('SELECT 1')
      .then(() => 'up')
      .catch(() => 'down');
    const broker = this.consumer.isConnected ? 'up' : 'down';
    const alertSink = this.sink.name;
    if (database !== 'up' || broker !== 'up') {
      throw new ServiceUnavailableException({ status: 'not ready', database, broker, alertSink });
    }
    return { status: 'ready', database, broker, alertSink };
  }

  /** Prometheus scrape endpoint. */
  @Get('metrics')
  @ApiExcludeEndpoint()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
