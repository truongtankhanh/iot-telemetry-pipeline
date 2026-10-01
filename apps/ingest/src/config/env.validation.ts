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
  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return env;
}
