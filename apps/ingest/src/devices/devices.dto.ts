import { METRIC_NAMES, type MetricName } from '@itp/telemetry-contract';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { QueryTimestamp } from './timestamp-query';

/** Query of `GET /devices/:id/readings`. Lives in a `*.dto.ts` file so the OpenAPI document lists its parameters. */
export class ReadingsQueryDto {
  /** Metric to return, e.g. `temperature_c`. */
  @IsIn(METRIC_NAMES)
  metric: MetricName;

  /** Start of the range (ISO 8601 with a zone, inclusive). Default: one hour before `to`. */
  @IsOptional()
  @QueryTimestamp()
  from?: Date;

  /** End of the range (ISO 8601 with a zone, exclusive). Default: now. */
  @IsOptional()
  @QueryTimestamp()
  to?: Date;

  /** `raw` readings, or `1m` per-minute summaries from the rollup table. */
  @ApiPropertyOptional() // it has a default, so a client need not send it
  @IsOptional()
  @IsIn(['raw', '1m'])
  resolution: 'raw' | '1m' = '1m';
}

/** A registered device, as `devices.json` describes it, with when it was last heard from. */
export class DeviceResponse {
  @ApiProperty({ example: 'dc-env-01' })
  id: string;

  @ApiProperty({ example: 'server_room' })
  kind: string;

  @ApiProperty({ example: 'BLD-DC' })
  zoneCode: string;

  @ApiProperty({ example: 'Data center — row A' })
  name: string;

  /** The metrics the device reports. */
  @ApiProperty({ enum: METRIC_NAMES, isArray: true, example: ['temperature_c', 'humidity_pct'] })
  metrics: MetricName[];

  /** The newest measurement time stored for the device, or `null` if none yet. */
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T08:00:02.000Z',
  })
  lastSeen: Date | null;
}

/** One stored reading. */
export class RawReading {
  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-16T07:59:02.000Z' })
  ts: Date;

  @ApiProperty({ example: 24.3 })
  value: number;
}

/** `resolution=raw`: individual readings, oldest first, at most 5 000 per response. */
export class RawReadingsResponse {
  @ApiProperty({ example: 'dc-env-01' })
  deviceId: string;

  @ApiProperty({ enum: METRIC_NAMES, example: 'temperature_c' })
  metric: MetricName;

  @ApiProperty({ enum: ['raw'], example: 'raw' })
  resolution: 'raw';

  /** The start of the range that was read (inclusive). */
  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-16T07:00:00.000Z' })
  from: Date;

  /** The end of the range that was read (exclusive). Send it again, unchanged, when paging. */
  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-16T08:00:00.000Z' })
  to: Date;

  /** `true` when more readings match than this response holds. */
  @ApiProperty({ example: false })
  truncated: boolean;

  /** Where the next page starts (send it as `from`), or `null` when nothing is missing. */
  @ApiProperty({ type: String, format: 'date-time', nullable: true, example: null })
  nextFrom: Date | null;

  @ApiProperty({ type: () => [RawReading] })
  points: RawReading[];
}

/** One minute of readings, summarised. */
export class RollupPoint {
  /** The start of the minute. */
  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-16T07:59:00.000Z' })
  bucket: Date;

  @ApiProperty({ type: 'integer', example: 30 })
  count: number;

  @ApiProperty({ example: 24.31 })
  avg: number;

  @ApiProperty({ example: 23.9 })
  min: number;

  @ApiProperty({ example: 24.8 })
  max: number;
}

/** `resolution=1m`: per-minute summaries from the rollup table, over a range of at most seven days. */
export class RollupReadingsResponse {
  @ApiProperty({ example: 'dc-env-01' })
  deviceId: string;

  @ApiProperty({ enum: METRIC_NAMES, example: 'temperature_c' })
  metric: MetricName;

  @ApiProperty({ enum: ['1m'], example: '1m' })
  resolution: '1m';

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-16T07:00:00.000Z' })
  from: Date;

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-16T08:00:00.000Z' })
  to: Date;

  @ApiProperty({ type: () => [RollupPoint] })
  points: RollupPoint[];
}
