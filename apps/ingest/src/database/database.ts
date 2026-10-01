import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { Env } from '../config/env.validation';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
/** Arbitrary constant: serialises migrations when several replicas boot at once. */
const MIGRATION_LOCK = 4_242_001;

/**
 * Thin wrapper around a pg Pool. The ingest path is bulk SQL (unnest inserts, upserts), so a
 * query builder or ORM would add weight without helping.
 */
@Injectable()
export class Database implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(Database.name);
  readonly pool: Pool;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: 10,
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.config.get('MIGRATE_ON_BOOT', { infer: true })) await this.migrate();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]) {
    return this.pool.query<T>(sql, params);
  }

  /** Runs `work` in a transaction; rolls back on any error. */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Applies `migrations/*.sql` in name order, once each, under an advisory lock. Plain SQL files
   * are reviewed as SQL; nothing is generated.
   */
  async migrate(): Promise<void> {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    await this.transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migration (
           name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
      );
      const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migration');
      const applied = new Set(rows.map((r) => r.name));
      for (const file of files.filter((f) => !applied.has(f))) {
        await client.query(await readFile(join(MIGRATIONS_DIR, file), 'utf8'));
        await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [file]);
        this.logger.log(`Applied migration ${file}`);
      }
    });
  }
}
