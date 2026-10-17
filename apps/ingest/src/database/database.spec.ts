import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Env } from '../config/env.validation';
import { Database } from './database';

type Statement = 'BEGIN' | 'COMMIT' | 'ROLLBACK';

/**
 * A real `Database` over a fake connection. The `pg` Pool connects lazily, so building it with a
 * syntactically valid URL opens nothing; `connect` is replaced before `transaction` is called.
 */
function setup(
  failures: Partial<Record<Statement, Error>> = {},
  options: {
    migrateOnBoot?: boolean;
    /** Answers or fails a statement; return nothing to fall back to an empty result. */
    answer?: (sql: string, params?: unknown[]) => { rows: unknown[] } | undefined;
  } = {},
) {
  const settings: Partial<Record<keyof Env, unknown>> = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/telemetry_test',
    MIGRATE_ON_BOOT: options.migrateOnBoot ?? false,
  };
  const config = { get: (key: keyof Env) => settings[key] } as unknown as ConfigService<Env, true>;
  const db = new Database(config);

  const statements: string[] = [];
  const calls: { sql: string; params?: unknown[] }[] = [];
  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      statements.push(sql);
      calls.push({ sql, params });
      const failure = failures[sql as Statement];
      if (failure) throw failure;
      return options.answer?.(sql, params) ?? { rows: [] };
    }),
    release: jest.fn(),
  };
  jest.spyOn(db.pool, 'connect').mockResolvedValue(client as unknown as never);
  return { db, client, statements, calls };
}

describe('Database.transaction', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('commits and releases the client normally', async () => {
    const { db, client, statements } = setup();

    const result = await db.transaction(async (c) => {
      await c.query('SELECT 1');
      return 'done';
    });

    expect(result).toBe('done');
    expect(statements).toEqual(['BEGIN', 'SELECT 1', 'COMMIT']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows the error of a failing work', async () => {
    const { db, client, statements } = setup();
    const failure = new Error('work failed');

    await expect(
      db.transaction(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rethrows the original error, not the rollback error, and destroys the client', async () => {
    const rollbackFailure = new Error('connection terminated unexpectedly');
    const { db, client } = setup({ ROLLBACK: rollbackFailure });
    const failure = new Error('work failed');

    await expect(
      db.transaction(async (c) => {
        await c.query('INSERT INTO reading VALUES ($1)', ['secret-value']);
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain('ROLLBACK failed');
    expect(message).toContain(rollbackFailure.message);
    expect(message).not.toContain(failure.message);
    expect(message).not.toContain('secret-value');
    expect(message).not.toContain('INSERT');
  });

  it('destroys the client when BEGIN and the following ROLLBACK both fail', async () => {
    const beginFailure = new Error('connection refused');
    const { db, client, statements } = setup({
      BEGIN: beginFailure,
      ROLLBACK: new Error('connection terminated unexpectedly'),
    });
    const work = jest.fn();

    await expect(db.transaction(work)).rejects.toBe(beginFailure);

    expect(work).not.toHaveBeenCalled();
    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('keeps the client when BEGIN fails but ROLLBACK works', async () => {
    const beginFailure = new Error('could not begin');
    const { db, client } = setup({ BEGIN: beginFailure });

    await expect(db.transaction(jest.fn())).rejects.toBe(beginFailure);

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
    expect(warn).not.toHaveBeenCalled();
  });

  it('rethrows a failing COMMIT and destroys the client when ROLLBACK fails too', async () => {
    const commitFailure = new Error('commit failed');
    const { db, client } = setup({
      COMMIT: commitFailure,
      ROLLBACK: new Error('connection terminated unexpectedly'),
    });

    await expect(db.transaction(async () => 'unused')).rejects.toBe(commitFailure);

    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(true);
  });
});

describe('Database.migrate', () => {
  const MIGRATIONS_DIR = join(__dirname, 'migrations');
  // Read from the directory, so adding a migration does not touch this test.
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const contentOf = (file: string) => readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  const recordOf = (file: string) => ({
    sql: 'INSERT INTO schema_migration (name) VALUES ($1)',
    params: [file],
  });
  /** The statements that run migrations or record them, in the order they were sent. */
  const migrationCalls = (calls: { sql: string; params?: unknown[] }[]) =>
    calls.filter(
      (c) =>
        c.sql.startsWith('INSERT INTO schema_migration') ||
        files.some((f) => c.sql === contentOf(f)),
    );
  const appliedAre = (names: string[]) => (sql: string) =>
    sql.startsWith('SELECT name FROM schema_migration')
      ? { rows: names.map((name) => ({ name })) }
      : undefined;

  let log: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('has migrations to run, or these cases prove nothing', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('takes the advisory lock first, inside one transaction', async () => {
    const { db, calls, statements } = setup();

    await db.migrate();

    expect(calls[0]!.sql).toBe('BEGIN');
    expect(calls[1]).toEqual({ sql: 'SELECT pg_advisory_xact_lock($1)', params: [4_242_001] });
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('creates schema_migration when missing, before reading what is applied', async () => {
    const { db, statements } = setup();

    await db.migrate();

    const create = statements.findIndex((s) =>
      s.includes('CREATE TABLE IF NOT EXISTS schema_migration'),
    );
    const read = statements.findIndex((s) => s.startsWith('SELECT name FROM schema_migration'));
    expect(create).toBeGreaterThan(1); // after BEGIN and the lock
    expect(read).toBeGreaterThan(create);
  });

  it('runs pending files in name order, recording each right after it, with the file content', async () => {
    const { db, calls } = setup({}, { answer: appliedAre([]) });

    await db.migrate();

    expect(migrationCalls(calls)).toEqual(
      files.flatMap((f) => [{ sql: contentOf(f), params: undefined }, recordOf(f)]),
    );
    for (const f of files) expect(log).toHaveBeenCalledWith(`Applied migration ${f}`);
  });

  it('skips files already applied', async () => {
    const last = files.at(-1)!;
    const { db, calls } = setup({}, { answer: appliedAre(files.slice(0, -1)) });

    await db.migrate();

    expect(migrationCalls(calls)).toEqual([
      { sql: contentOf(last), params: undefined },
      recordOf(last),
    ]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('sends nothing and logs nothing when everything is applied', async () => {
    const { db, calls, statements } = setup({}, { answer: appliedAre(files) });

    await db.migrate();

    expect(migrationCalls(calls)).toEqual([]);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(log).not.toHaveBeenCalled();
  });

  it('rolls back, rethrows the original error and records nothing when a migration fails', async () => {
    const failure = new Error('syntax error at or near "CREATE"');
    const first = contentOf(files[0]!);
    const { db, calls, statements } = setup(
      {},
      {
        answer: (sql) => {
          if (sql === first) throw failure;
          return appliedAre([])(sql);
        },
      },
    );

    await expect(db.migrate()).rejects.toBe(failure);

    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
    expect(calls.some((c) => c.sql.startsWith('INSERT INTO schema_migration'))).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it('migrates at boot only when MIGRATE_ON_BOOT is true', async () => {
    const on = setup({}, { migrateOnBoot: true });
    const migrateOn = jest.spyOn(on.db, 'migrate').mockResolvedValue();
    await on.db.onModuleInit();
    expect(migrateOn).toHaveBeenCalledTimes(1);

    const off = setup({}, { migrateOnBoot: false });
    const migrateOff = jest.spyOn(off.db, 'migrate').mockResolvedValue();
    await off.db.onModuleInit();
    expect(migrateOff).not.toHaveBeenCalled();
  });
});
