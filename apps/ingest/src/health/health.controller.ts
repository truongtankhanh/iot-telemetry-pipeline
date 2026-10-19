import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Database } from '../database/database';
import { ALERT_SINK, type AlertSink } from '../delivery/alert-sink';
import { Metrics } from '../metrics/metrics';
import { MqttConsumer } from '../telemetry/mqtt-consumer.service';
import { HealthResponse, NotReadyResponse, ReadyResponse } from './health.dto';

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
  @ApiOkResponse({ description: 'The process is up.', type: HealthResponse })
  health(): HealthResponse {
    return { status: 'ok' };
  }

  /**
   * Readiness: database reachable and subscribed to the broker. `alertSink` is reported for
   * information only: a service without a command center (`none`) is still ready.
   */
  @Get('ready')
  @ApiOkResponse({
    description: 'The database answers and a broker connection is up.',
    type: ReadyResponse,
  })
  @ApiServiceUnavailableResponse({
    description: 'The database or the broker is down. The body is not the standard error envelope.',
    type: NotReadyResponse,
  })
  async ready(): Promise<ReadyResponse> {
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
