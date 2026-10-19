import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { currentContext } from './log-context';

/** A `ConsoleLogger` whose JSON lines also carry the log context (the request id, for one). */
export class ContextLogger extends ConsoleLogger {
  // Nest does not export the type of `options`, and a protected method cannot be read through
  // `ConsoleLogger['getJsonLogObject']`, so it is written out here.
  protected override getJsonLogObject(
    message: unknown,
    options: {
      context: string;
      logLevel: LogLevel;
      writeStreamType?: 'stdout' | 'stderr';
      errorStack?: unknown;
      params?: Record<string, unknown>;
      error?: Error;
    },
  ) {
    return { ...super.getJsonLogObject(message, options), ...currentContext() };
  }
}
