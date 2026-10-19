import { ApiProperty } from '@nestjs/swagger';

/** `GET /health`: the process is up. */
export class HealthResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status: 'ok';
}

/** `GET /ready` when the service can take traffic: the database answers and a broker connection is up. */
export class ReadyResponse {
  @ApiProperty({ enum: ['ready'], example: 'ready' })
  status: 'ready';

  @ApiProperty({ enum: ['up'], example: 'up' })
  database: string;

  @ApiProperty({ enum: ['up'], example: 'up' })
  broker: string;

  /** Informational: `none` means no command center is configured, so alerts are recorded and never delivered. */
  @ApiProperty({ enum: ['none', 'ops-command-center'], example: 'ops-command-center' })
  alertSink: string;
}

/**
 * `GET /ready` with a status of 503: the database or the broker is down. This is the body itself,
 * not the standard error envelope (`ErrorResponse`).
 */
export class NotReadyResponse {
  @ApiProperty({ enum: ['not ready'], example: 'not ready' })
  status: 'not ready';

  @ApiProperty({ enum: ['up', 'down'], example: 'down' })
  database: string;

  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  broker: string;

  @ApiProperty({ enum: ['none', 'ops-command-center'], example: 'none' })
  alertSink: string;
}
