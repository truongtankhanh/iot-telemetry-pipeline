import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Database } from '../database/database';
import { ErrorResponse } from '../error-response.dto';
import { AlertResponse, AlertsQueryDto } from './alerts.dto';
import { decodeCursor, encodeCursor } from './cursor';

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
  @ApiOperation({
    summary: 'Alerts, newest first, with the delivery state of their latest outbox event',
    description:
      'When more alerts follow, the response header `X-Next-Cursor` holds the `before` for the next page. The body is always a plain array.',
  })
  @ApiOkResponse({
    description: 'Up to `limit` alerts.',
    type: [AlertResponse],
    headers: {
      'X-Next-Cursor': {
        description:
          'Present when more alerts follow: send it as `before` to get the next page. Opaque.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'The query is not valid: `status`, `limit`, or a `before` this API did not return.',
    type: ErrorResponse,
  })
  async list(
    @Query() query: AlertsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AlertResponse[]> {
    const after = query.before === undefined ? undefined : decodeCursor(query.before);
    // One row past the limit tells "exactly a page" from "more to come".
    const { rows } = await this.db.query<AlertResponse>(
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
