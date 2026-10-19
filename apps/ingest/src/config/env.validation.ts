import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { tlsSettingsProblems } from '../telemetry/mqtt-options';

const toBoolean = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? ['true', '1', 'yes'].includes(value.toLowerCase()) : value;

/** `FOO=` in a shell or compose file means "not set". */
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

/** Every environment variable the service reads. The service refuses to start if this fails. */
export class Env {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3100;

  @IsString()
  DATABASE_URL: string;

  /**
   * Connections this process may hold open to PostgreSQL. A flush, the outbox worker, the API and the
   * maintenance share them; the setting is a connection budget (replicas × this against the server's
   * `max_connections`), not a throughput lever: one flush runs at a time. Below 2 a flush and any other
   * statement would queue behind each other.
   */
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(100)
  DB_POOL_MAX = 10;

  /**
   * Cancels any statement that runs longer than this (ms) with SQLSTATE 57014. 0, the default, sets
   * nothing and leaves the server's own setting alone. Migrations and partition maintenance exempt
   * themselves. A value of a few hundred ms or less would cancel ordinary flushes.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  DB_STATEMENT_TIMEOUT_MS = 0;

  @IsString()
  MQTT_URL = 'mqtt://localhost:1883';

  /** MQTT 5 shared-subscription group; empty to subscribe without sharing. */
  @IsOptional()
  @IsString()
  MQTT_SHARE_GROUP = 'ingest';

  @IsOptional()
  @IsString()
  MQTT_USERNAME?: string;

  @IsOptional()
  @IsString()
  MQTT_PASSWORD?: string;

  /** Client ids are `<prefix>-<instance>-<n>`; a broker policy can allow exactly `<prefix>-*`. */
  @IsString()
  MQTT_CLIENT_ID_PREFIX = 'ingest';

  /**
   * Connections this process opens into the shared-subscription group. Brokers that cap delivery
   * per connection (AWS IoT Core: 100 messages/s by default) are scaled past the cap this way.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(32)
  MQTT_CONNECTIONS = 1;

  /** Mutual TLS, as PEM text (real newlines or `\n`). Required by AWS IoT Core. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  MQTT_CA_PEM?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  MQTT_CERT_PEM?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  MQTT_KEY_PEM?: string;

  /** Flush the write buffer at least this often (ms). Bounds the loss window — ADR-0002. */
  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(5000)
  FLUSH_INTERVAL_MS = 250;

  /** …or as soon as this many readings are buffered. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20_000)
  FLUSH_MAX_READINGS = 1000;

  /**
   * Readings held in memory (buffered or being written) before the consumer stops acknowledging
   * messages, so the broker's queue absorbs a database outage instead of this process's memory.
   */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  BUFFER_MAX_READINGS = 20_000;

  /**
   * How long a gap in a device's sequence numbers stays open before it counts as lost: replicas
   * flush on their own clocks, so a message can land after its successor. 0 counts at once.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  SEQUENCE_GRACE_MS = 30_000;

  /** Days of raw readings kept; older daily partitions are dropped. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RETENTION_DAYS = 30;

  /** Base URL of ops-command-center's API, e.g. http://localhost:3000/api. Unset = no delivery. */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUrl({ require_tld: false })
  OCC_API_URL?: string;

  /**
   * Client credentials for the command center's identity provider (ADR-0006): all three or none.
   * Without them, requests carry no token — enough for a command center without sign-in.
   */
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsUrl({ require_tld: false })
  OCC_TOKEN_URL?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  OCC_CLIENT_ID?: string;

  @Transform(emptyToUndefined)
  @IsOptional()
  @IsString()
  OCC_CLIENT_SECRET?: string;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  DELIVERY_INTERVAL_MS = 1000;

  /** Directory holding devices.json and rules.json. */
  @IsString()
  CONFIG_DIR = 'config';

  @Transform(toBoolean)
  @IsBoolean()
  MIGRATE_ON_BOOT = true;

  /**
   * Serves the OpenAPI UI at /api/docs (and its JSON). Off unless asked for: local development and
   * the demo stack turn it on, the Kubernetes base leaves it off (V1-T04).
   */
  @Transform(toBoolean)
  @IsBoolean()
  API_DOCS_ENABLED = false;

  /**
   * `json` writes one JSON object per line, for a log aggregator; `text` is the readable, coloured
   * output of Nest's default logger. The container image sets `json`; the level is set with Nest's
   * own `NEST_LOG_LEVEL`. A bad value stops the service, but that one error is still printed as
   * text, because the format is not known yet when the environment fails validation.
   */
  @IsIn(['text', 'json'])
  LOG_FORMAT: 'text' | 'json' = 'text';
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw);
  const errors = validateSync(env);
  const problems = [
    ...errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`),
    ...tlsSettingsProblems(env),
    ...occCredentialProblems(env),
    ...bufferProblems(env),
  ];
  if (problems.length > 0) {
    const details = problems.map((p) => `  - ${p}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return env;
}

/** Below one batch the ceiling would pause consumption before a flush is even due. */
function bufferProblems(env: Env): string[] {
  if (env.BUFFER_MAX_READINGS < env.FLUSH_MAX_READINGS * 2) {
    return ['BUFFER_MAX_READINGS must be at least twice FLUSH_MAX_READINGS'];
  }
  return [];
}

function occCredentialProblems(env: Env): string[] {
  const set = [env.OCC_TOKEN_URL, env.OCC_CLIENT_ID, env.OCC_CLIENT_SECRET].filter(Boolean).length;
  if (set !== 0 && set !== 3) {
    return ['OCC_TOKEN_URL, OCC_CLIENT_ID and OCC_CLIENT_SECRET must be set together'];
  }
  if (set === 3 && !env.OCC_API_URL)
    return ['OCC client credentials are set but OCC_API_URL is not'];
  return [];
}
