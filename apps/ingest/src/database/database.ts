import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type { Env } from '../config/env.validation';

const MIGRATIONS_DIR = join(__dirname, 'migrations');
/**
 * Shown in `pg_stat_activity`. Fixed, not the pod name: PostgreSQL cuts the name at 63 characters
 * without an error, and `client_addr` already tells replicas apart.
 */
const APPLICATION_NAME = 'telemetry-ingest';
/**
 * First statement of a transaction that must not be cut short by `DB_STATEMENT_TIMEOUT_MS`: the
 * migration runner and the partition maintenance wait for an advisory lock another replica holds, and
 * run DDL that takes `ACCESS EXCLUSIVE` locks. `SET LOCAL` ends with the transaction.
 */
export const EXEMPT_FROM_STATEMENT_TIMEOUT = 'SET LOCAL statement_timeout = 0';
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
    // pg sends the parameter only when it is truthy, so 0 leaves the server's setting in force.
    const statementTimeoutMs = config.get('DB_STATEMENT_TIMEOUT_MS', { infer: true });
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: config.get('DB_POOL_MAX', { infer: true }),
      application_name: APPLICATION_NAME,
      ...(statementTimeoutMs > 0 ? { statement_timeout: statementTimeoutMs } : {}),
      // Without it a connection attempt to an unreachable server waits for the OS to give up.
      connectionTimeoutMillis: 5_000,
    });
    // An idle connection dropped by a database restart is emitted as an error; with no listener
    // that error would kill the process instead of letting the next query reconnect.
    this.pool.on('error', (error) => this.logger.warn(`Idle connection lost: ${error.message}`));
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

  /**
   * Runs `work` in a transaction; rolls back on any error and rethrows it. If the `ROLLBACK`
   * itself fails, that is logged, the original error is still the one rethrown, and the
   * connection is discarded instead of returned to the pool.
   */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // A failed ROLLBACK usually means the connection is dead, and callers (BatchWriter's
        // isDataError) classify on the error thrown here, so the original must survive it.
        broken = true;
        const reason =
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        this.logger.warn(`ROLLBACK failed, discarding the connection: ${reason}`);
      }
      throw error;
    } finally {
      // release(true) makes the pool destroy the client instead of keeping it for reuse.
      if (broken) client.release(true);
      else client.release();
    }
  }

  /**
   * Applies `migrations/*.sql` in name order, once each, under an advisory lock. Plain SQL files
   * are reviewed as SQL; nothing is generated.
   */
  async migrate(): Promise<void> {
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    await this.transaction(async (client) => {
      await client.query(EXEMPT_FROM_STATEMENT_TIMEOUT);
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
