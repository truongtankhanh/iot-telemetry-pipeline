import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString } from 'class-validator';
import { Database } from '../database/database';
import { DevicesService } from './devices.service';

const MAX_RAW_POINTS = 5000;
const DEFAULT_RANGE_MS = 60 * 60_000;

export class ReadingsQueryDto {
  /** Metric to return, e.g. `temperature_c`. */
  @IsString()
  metric: string;

  /** Start of the range (ISO 8601). Default: one hour before `to`. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** End of the range (ISO 8601). Default: now. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  /** `raw` readings, or `1m` per-minute summaries from the rollup table. */
  @IsOptional()
  @IsIn(['raw', '1m'])
  resolution: 'raw' | '1m' = '1m';
}

@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly db: Database,
  ) {}

  /** Registered devices with when they were last heard from. */
  @Get()
  async list() {
    const { rows } = await this.db.query<{ id: string; last_seen: Date | null }>(
      'SELECT id, last_seen FROM device',
    );
    const lastSeen = new Map(rows.map((r) => [r.id, r.last_seen]));
    return this.devices.all().map((d) => ({ ...d, lastSeen: lastSeen.get(d.id) ?? null }));
  }

  /** Readings for one device and metric over a time range. */
  @Get(':id/readings')
  async readings(@Param('id') id: string, @Query() query: ReadingsQueryDto) {
    const device = this.devices.get(id);
    if (!device) throw new NotFoundException(`Device ${id} is not registered`);
    if (!device.metrics.includes(query.metric as never)) {
      throw new NotFoundException(`Device ${id} does not report ${query.metric}`);
    }
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_RANGE_MS);

    if (query.resolution === 'raw') {
      const { rows } = await this.db.query<{ ts: Date; value: number }>(
        `SELECT ts, value FROM reading
         WHERE device_id = $1 AND metric = $2 AND ts >= $3 AND ts < $4
         ORDER BY ts LIMIT $5`,
        [id, query.metric, from, to, MAX_RAW_POINTS],
      );
      return { deviceId: id, metric: query.metric, resolution: 'raw', from, to, points: rows };
    }

    const { rows } = await this.db.query<{
      bucket: Date;
      count: number;
      avg: number;
      min: number;
      max: number;
    }>(
      `SELECT bucket, count, sum / count AS avg, min, max FROM rollup_1m
       WHERE device_id = $1 AND metric = $2 AND bucket >= $3 AND bucket < $4
       ORDER BY bucket`,
      [id, query.metric, from, to],
    );
    return { deviceId: id, metric: query.metric, resolution: '1m', from, to, points: rows };
  }
}
