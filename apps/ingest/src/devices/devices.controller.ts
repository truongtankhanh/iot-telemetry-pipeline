import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { METRIC_NAMES, type MetricName } from '@itp/telemetry-contract';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional } from 'class-validator';
import { Database } from '../database/database';
import { DevicesService } from './devices.service';

const MAX_RAW_POINTS = 5000;
const MINUTE_MS = 60_000;
/**
 * Longest range `resolution=1m` accepts, in minutes. One bucket is one minute, so this is also the
 * most buckets a response can hold (about a week of chart, around a megabyte of JSON).
 */
const MAX_ROLLUP_BUCKETS = 10_080;
const DEFAULT_RANGE_MS = 60 * MINUTE_MS;

export class ReadingsQueryDto {
  /** Metric to return, e.g. `temperature_c`. */
  @IsIn(METRIC_NAMES)
  metric: MetricName;

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
    if (!device.metrics.includes(query.metric)) {
      throw new NotFoundException(`Device ${id} does not report ${query.metric}`);
    }
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_RANGE_MS);
    // Here, not in the DTO: each bound defaults from the other, so only now are both known.
    if (from >= to) throw new BadRequestException('"from" must be earlier than "to"');

    if (query.resolution === 'raw') {
      // One row past the cap tells "exactly the cap" from "more than the cap". `from` is inclusive
      // and (device, metric, ts) is unique, so that row's `ts` is where the next page starts.
      const { rows } = await this.db.query<{ ts: Date; value: number }>(
        `SELECT ts, value FROM reading
         WHERE device_id = $1 AND metric = $2 AND ts >= $3 AND ts < $4
         ORDER BY ts LIMIT $5`,
        [id, query.metric, from, to, MAX_RAW_POINTS + 1],
      );
      const truncated = rows.length > MAX_RAW_POINTS;
      return {
        deviceId: id,
        metric: query.metric,
        resolution: 'raw',
        from,
        to,
        truncated,
        nextFrom: truncated ? rows[MAX_RAW_POINTS].ts : null,
        points: truncated ? rows.slice(0, MAX_RAW_POINTS) : rows,
      };
    }

    if (to.getTime() - from.getTime() > MAX_ROLLUP_BUCKETS * MINUTE_MS) {
      throw new BadRequestException(
        `resolution=1m accepts a range of at most ${MAX_ROLLUP_BUCKETS} minutes ` +
          `(${MAX_ROLLUP_BUCKETS / 1440} days); narrow "from" and "to"`,
      );
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
