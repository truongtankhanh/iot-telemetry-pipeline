import { ConsoleLogger } from '@nestjs/common';
import type { Env } from '../config/env.validation';

/**
 * The logger the service installs at boot. Nest's own `ConsoleLogger` in both cases, so there is no
 * logging library to carry. No `logLevels` are passed, so `NEST_LOG_LEVEL` keeps setting the level.
 */
export function createLogger(format: Env['LOG_FORMAT']): ConsoleLogger {
  return format === 'json' ? new ConsoleLogger({ json: true, colors: false }) : new ConsoleLogger();
}
