import { AsyncLocalStorage } from 'node:async_hooks';

/** Fields that every JSON log line carries while they are set. */
export interface LogContext {
  /** The HTTP request being served. */
  requestId?: string;
  /** The write batch being flushed. */
  batchId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/**
 * Runs `fn` with `fields` added to the log context of everything it starts, awaits and timers
 * included. A nested call keeps the fields of the outer one. Code that starts outside any run (the
 * flush timer, the MQTT consumer, boot) has an empty context.
 */
export function runWithContext<T>(fields: LogContext, fn: () => T): T {
  return storage.run({ ...currentContext(), ...fields }, fn);
}

export function currentContext(): LogContext {
  return storage.getStore() ?? {};
}
