import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { METRIC_NAMES, type MetricName } from '@itp/telemetry-contract';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../config/env.validation';
import { Database } from '../database/database';

export interface Device {
  id: string;
  kind: string;
  zoneCode: string;
  name: string;
  metrics: MetricName[];
}

/** Loads `devices.json`, validates it, upserts it into `device`, and serves lookups from memory. */
@Injectable()
export class DevicesService implements OnModuleInit {
  private readonly logger = new Logger(DevicesService.name);
  private readonly devices = new Map<string, Device>();

  constructor(
    private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    const path = join(this.config.get('CONFIG_DIR', { infer: true }), 'devices.json');
    const list = parseDevices(JSON.parse(readFileSync(path, 'utf8')));
    for (const device of list) this.devices.set(device.id, device);

    // A handful of rows, once at boot: one statement per device keeps the SQL obvious.
    await this.db.transaction(async (client) => {
      for (const d of list) {
        await client.query(
          `INSERT INTO device (id, kind, zone_code, name, metrics) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, zone_code = EXCLUDED.zone_code,
             name = EXCLUDED.name, metrics = EXCLUDED.metrics`,
          [d.id, d.kind, d.zoneCode, d.name, d.metrics],
        );
      }
    });
    this.logger.log(`Registered ${list.length} devices from ${path}`);
  }

  get(id: string): Device | undefined {
    return this.devices.get(id);
  }

  all(): Device[] {
    return [...this.devices.values()];
  }

  kinds(): Set<string> {
    return new Set(this.all().map((d) => d.kind));
  }
}

export function parseDevices(input: unknown): Device[] {
  const list = (input as { devices?: unknown })?.devices;
  if (!Array.isArray(list) || list.length === 0)
    throw new Error('devices.json: "devices" must be a non-empty array');
  const seen = new Set<string>();
  return list.map((raw, i) => {
    const d = raw as Partial<Device>;
    const where = `devices.json: devices[${i}]`;
    for (const key of ['id', 'kind', 'zoneCode', 'name'] as const) {
      if (typeof d[key] !== 'string' || !d[key]) throw new Error(`${where}.${key} is required`);
    }
    if (seen.has(d.id!)) throw new Error(`${where}: duplicate id "${d.id}"`);
    seen.add(d.id!);
    if (!Array.isArray(d.metrics) || d.metrics.length === 0)
      throw new Error(`${where}.metrics is required`);
    for (const metric of d.metrics) {
      if (!METRIC_NAMES.includes(metric)) throw new Error(`${where}: unknown metric "${metric}"`);
    }
    return d as Device;
  });
}
