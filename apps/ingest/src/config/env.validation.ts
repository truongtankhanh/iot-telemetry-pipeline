import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw);
  const errors = validateSync(env);
  const problems = [
    ...errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`),
    ...tlsSettingsProblems(env),
    ...occCredentialProblems(env),
  ];
  if (problems.length > 0) {
    const details = problems.map((p) => `  - ${p}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return env;
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
