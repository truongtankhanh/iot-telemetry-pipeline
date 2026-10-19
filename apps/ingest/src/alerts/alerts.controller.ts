import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { Database } from '../database/database';
import { decodeCursor, encodeCursor } from './cursor';

const MAX_LIMIT = 200;

export class AlertsQueryDto {
  @IsOptional()
  @IsIn(['open', 'cleared'])
  status?: 'open' | 'cleared';

  /** Alerts per page. Default and maximum: 200. */
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

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly db: Database) {}

  /**
   * Most recent alerts first, with the delivery state of their latest outbox event. When more
   * remain, the response header `X-Next-Cursor` holds the `before` for the next page; the body stays
   * a plain array.
   */
  @Get()
  async list(@Query() query: AlertsQueryDto, @Res({ passthrough: true }) res: Response) {
    const after = query.before === undefined ? undefined : decodeCursor(query.before);
    // One row past the limit tells "exactly a page" from "more to come".
    const { rows } = await this.db.query<{ id: string; openedAt: Date }>(
      `SELECT a.id, a.device_id AS "deviceId", a.rule_id AS "ruleId", a.metric, a.severity, a.title,
              a.status, a.opened_at AS "openedAt", a.opened_value AS "openedValue",
              a.cleared_at AS "clearedAt", a.cleared_value AS "clearedValue",
              a.external_ref AS "externalRef",
              d.status AS "deliveryStatus", d.attempts AS "deliveryAttempts", d.last_error AS "deliveryError"
       FROM alert a
       LEFT JOIN LATERAL (
         SELECT status, attempts, last_error FROM alert_delivery
         WHERE alert_id = a.id ORDER BY id DESC LIMIT 1
       ) d ON true
       WHERE ($1::text IS NULL OR a.status = $1)
         AND ($2::timestamptz IS NULL OR (a.opened_at, a.id) < ($2::timestamptz, $3::bigint))
       ORDER BY a.opened_at DESC, a.id DESC
       LIMIT $4`,
      [query.status ?? null, after?.openedAt ?? null, after?.id ?? null, query.limit + 1],
    );
    if (rows.length <= query.limit) return rows;

    const page = rows.slice(0, query.limit);
    res.setHeader('X-Next-Cursor', encodeCursor(page[page.length - 1]!));
    return page;
  }
}
