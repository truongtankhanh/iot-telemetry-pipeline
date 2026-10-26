import { type ChildMessage, parseParentMessage, type StartMessage } from './bench-protocol.ts';
import { connectBenchIo, redact, runBenchmark, sessionTsBase } from './bench-run.ts';

/**
 * The benchmark process of Studio: a child of the control server, started with `fork`. It takes its settings
 * from the first message on the IPC channel (so the database URL is never on a command line), runs the
 * loop of `bench-run.ts`, reports progress and the result, and exits. A `stop` message, or the channel
 * closing because the server went away, ends the run at the next window of messages: the run never outlives
 * its owner.
 */

if (typeof process.send !== 'function') {
  console.error(
    'bench-worker.ts is started by the Studio control server; it takes its settings over IPC.',
  );
  process.exit(1);
}

const controller = new AbortController();
let started = false;

/** Resolves once the message is written, or at once when the channel is already closed. */
function send(message: ChildMessage): Promise<void> {
  return new Promise((resolve) => {
    if (!process.connected) return resolve();
    process.send?.(message, () => resolve());
  });
}

async function run(start: StartMessage): Promise<void> {
  const connection = await connectBenchIo({ broker: start.broker, database: start.database });
  try {
    // Continue each device from the ledger instead of seeding it: a jump from the engine's small `last_seq`
    // to 1,000,001 would open a hole that ingest later counts as a million lost messages.
    const firstSeq = await connection.firstSeqs();
    const { outcome, result } = await runBenchmark({
      devices: start.devices,
      messages: start.messages,
      timeoutS: start.timeoutS,
      io: connection,
      signal: controller.signal,
      firstSeq,
      tsBase: sessionTsBase({
        wallMs: Date.now(),
        devices: start.devices.length,
        run: start.run,
      }),
      onProgress: (progress) => void send({ type: 'progress', progress }),
      log: () => undefined,
    });
    await send({ type: 'done', outcome, result });
  } finally {
    await connection.close();
  }
}

process.on('message', (value) => {
  const message = parseParentMessage(value);
  if (message === undefined) return;
  if (message.type === 'stop') {
    controller.abort();
    return;
  }
  if (started) return;
  started = true;
  run(message).then(
    () => process.exit(0),
    async (error: unknown) => {
      // A failure to connect is the usual one; the reason must not carry a password.
      await send({
        type: 'error',
        message: redact(error instanceof Error ? error.message : String(error)),
      });
      process.exit(1);
    },
  );
});

// The server closed the channel (it ended, or killed us): finish at the next window and go.
process.on('disconnect', () => controller.abort());
