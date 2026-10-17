import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import type { Database } from '../database/database';
import type { DevicesService } from '../devices/devices.service';
import type { Metrics } from '../metrics/metrics';
import type { RulesService } from '../rules/rules.service';
import type { AlertSink } from './alert-sink';
import { DeliveryWorker } from './delivery.worker';

/** Only what the bootstrap hook touches is real: the logger, the config and the sink name. */
function workerWith(sinkName: string): DeliveryWorker {
  const config = {
    get: (key: keyof Env) => (key === 'DELIVERY_INTERVAL_MS' ? 1_000 : undefined),
  } as unknown as ConfigService<Env, true>;
  return new DeliveryWorker(
    {} as unknown as Database,
    {} as unknown as DevicesService,
    {} as unknown as RulesService,
    {} as unknown as Metrics,
    config,
    { name: sinkName } as unknown as AlertSink,
  );
}

describe('DeliveryWorker bootstrap', () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;
  let worker: DeliveryWorker | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });
  afterEach(async () => {
    // Clears the delivery interval the hook started.
    await worker?.beforeApplicationShutdown();
    worker = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('warns once when there is no command center, and does not log it as a plain boot line', () => {
    worker = workerWith('none');

    worker.onApplicationBootstrap();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Alert sink: none'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Set OCC_API_URL'));
    expect(log).not.toHaveBeenCalled();
  });

  it('logs the sink name without a warning when a command center is configured', () => {
    worker = workerWith('ops-command-center');

    worker.onApplicationBootstrap();

    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Alert sink: ops-command-center');
  });

  it('starts the delivery interval either way, and shutdown clears it', async () => {
    worker = workerWith('none');

    worker.onApplicationBootstrap();
    expect(jest.getTimerCount()).toBe(1);

    await worker.beforeApplicationShutdown();
    expect(jest.getTimerCount()).toBe(0);
  });
});
