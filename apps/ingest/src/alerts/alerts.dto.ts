import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const MAX_LIMIT = 200;

/** Query of `GET /alerts`. Lives in a `*.dto.ts` file so the OpenAPI document lists its parameters. */
export class AlertsQueryDto {
  @IsOptional()
  @IsIn(['open', 'cleared'])
  status?: 'open' | 'cleared';

  /** Alerts per page. Default and maximum: 200. */
  @ApiPropertyOptional() // it has a default, so a client need not send it
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = MAX_LIMIT;

  /** Where the previous page ended: the `X-Next-Cursor` header of its response. Opaque. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  before?: string;
}

/**
 * An alert and the state of its latest outbox event. The delivery fields are `null` for an alert
 * that has no outbox row.
 */
export class AlertResponse {
  /** A string, because the column is a `bigint`. */
  @ApiProperty({ example: '7' })
  id: string;

  @ApiProperty({ example: 'dc-env-01' })
  deviceId: string;

  @ApiProperty({ example: 'server-room-hot' })
  ruleId: string;

  @ApiProperty({ example: 'temperature_c' })
  metric: string;

  @ApiProperty({ enum: ['low', 'medium', 'high', 'critical'], example: 'high' })
  severity: 'low' | 'medium' | 'high' | 'critical';

  @ApiProperty({ example: 'Server room temperature high' })
  title: string;

  @ApiProperty({ enum: ['open', 'cleared'], example: 'cleared' })
  status: 'open' | 'cleared';

  @ApiProperty({ type: String, format: 'date-time', example: '2026-10-16T08:00:26.000Z' })
  openedAt: Date;

  @ApiProperty({ example: 29.3 })
  openedValue: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: '2026-10-16T08:01:30.000Z',
  })
  clearedAt: Date | null;

  @ApiProperty({ type: Number, nullable: true, example: 25.1 })
  clearedValue: number | null;

  /** The incident id in ops-command-center, once the `opened` event was delivered. */
  @ApiProperty({ type: String, nullable: true, example: 'c3a1…' })
  externalRef: string | null;

  /** State of the alert's latest outbox event. */
  @ApiProperty({
    enum: ['pending', 'delivered', 'skipped', 'failed'],
    nullable: true,
    example: 'delivered',
  })
  deliveryStatus: 'pending' | 'delivered' | 'skipped' | 'failed' | null;

  @ApiProperty({ type: 'integer', nullable: true, example: 1 })
  deliveryAttempts: number | null;

  @ApiProperty({ type: String, nullable: true, example: null })
  deliveryError: string | null;
}
