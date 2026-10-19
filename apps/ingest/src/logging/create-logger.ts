import { ConsoleLogger } from '@nestjs/common';
import type { Env } from '../config/env.validation';
import { ContextLogger } from './context-logger';

/**
 * The logger the service installs at boot. Nest's own `ConsoleLogger` in both cases, so there is no
 * logging library to carry. No `logLevels` are passed, so `NEST_LOG_LEVEL` keeps setting the level.
 * Only the JSON lines carry the log context (the request id); the text format has no ids.
 */
export function createLogger(format: Env['LOG_FORMAT']): ConsoleLogger {
  return format === 'json' ? new ContextLogger({ json: true, colors: false }) : new ConsoleLogger();
}
