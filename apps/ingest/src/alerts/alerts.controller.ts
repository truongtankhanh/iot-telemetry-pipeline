import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Database } from '../database/database';

export class AlertsQueryDto {
  @IsOptional()
  @IsIn(['open', 'cleared'])
  status?: 'open' | 'cleared';
}

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly db: Database) {}

  /** Most recent alerts first, with the delivery state of their latest outbox event. */
  @Get()
  async list(@Query() query: AlertsQueryDto) {
    const { rows } = await this.db.query(
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
       WHERE $1::text IS NULL OR a.status = $1
       ORDER BY a.opened_at DESC
       LIMIT 200`,
      [query.status ?? null],
    );
    return rows;
  }
}
