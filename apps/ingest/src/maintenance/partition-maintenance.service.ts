import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { Database } from '../database/database';
import { expiredPartitions, partitionName, requiredDays } from './partitions';

const HOUR = 3_600_000;
/** Serialises maintenance across replicas. */
const MAINTENANCE_LOCK = 4_242_002;

/**
 * Keeps daily `reading` partitions created ahead and drops those past retention (ADR-0003).
 * Runs at startup — before ingest begins — and hourly. No external cron needed.
 */
@Injectable()
export class PartitionMaintenance implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(PartitionMaintenance.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.run();
    this.timer = setInterval(
      () => void this.run().catch((e: Error) => this.logger.error(e.message)),
      HOUR,
    );
  }

  beforeApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async run(now = new Date()): Promise<{ created: string[]; dropped: string[] }> {
    const retention = this.config.get('RETENTION_DAYS', { infer: true });
    return this.db.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [MAINTENANCE_LOCK]);
      const { rows } = await client.query<{ name: string }>(
        `SELECT c.relname AS name FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_class p ON p.oid = i.inhparent
         WHERE p.relname = 'reading'`,
      );
      const existing = new Set(rows.map((r) => r.name));

      const created: string[] = [];
      for (const day of requiredDays(now)) {
        const name = partitionName(day);
        if (existing.has(name)) continue;
        const next = new Date(day.getTime() + 86_400_000);
        await client.query(
          `CREATE TABLE ${name} PARTITION OF reading
           FOR VALUES FROM ('${day.toISOString()}') TO ('${next.toISOString()}')`,
        );
        created.push(name);
      }

      const dropped = expiredPartitions([...existing], now, retention);
      for (const name of dropped) await client.query(`DROP TABLE ${name}`);
      await client.query(`DELETE FROM rollup_1m WHERE bucket < now() - make_interval(days => $1)`, [
        retention,
      ]);

      if (created.length || dropped.length) {
        this.logger.log(
          `Partitions created: [${created.join(', ')}] dropped: [${dropped.join(', ')}]`,
        );
      }
      return { created, dropped };
    });
  }
}
