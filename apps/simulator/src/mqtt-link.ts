import type { LinkControl } from './faults.ts';

/** How long `restore` waits for the broker to accept the connection again. */
export const RESTORE_TIMEOUT_MS = 10_000;

/**
 * What `MqttLink` needs of the MQTT client, as four plain functions so that a test needs no client and no broker.
 * `main.ts` builds it from the `mqtt` client (`endAsync(true)`, `reconnect()`, the `connect` event).
 */
export interface LinkTransport {
  isConnected(): boolean;
  /** Ends the connection at once, without waiting for messages in flight, and stops the client from reconnecting. */
  end(): Promise<void>;
  /** Starts connecting again; the `connect` event says it worked. */
  reconnect(): void;
  /** Calls `listener` once, the next time the client connects. Returns the function that takes it off again. */
  onceConnect(listener: () => void): () => void;
}

/**
 * The link-loss fault of the engine, over the simulator's own MQTT connection. `cut` really ends the connection
 * (so the broker and ingest see the device go, and the Broker pill turns by itself: `main.ts` feeds `BrokerLink` from
 * the client's events). `restore` connects again and settles when the broker has accepted it, or fails with a reason
 * after the timeout, leaving the client to go on trying.
 */
export class MqttLink implements LinkControl {
  private readonly transport: LinkTransport;
  private readonly timeoutMs: number;

  constructor(transport: LinkTransport, timeoutMs: number = RESTORE_TIMEOUT_MS) {
    this.transport = transport;
    this.timeoutMs = timeoutMs;
  }

  async cut(): Promise<void> {
    await this.transport.end();
  }

  async restore(): Promise<void> {
    if (this.transport.isConnected()) return;
    await new Promise<void>((resolve, reject) => {
      let off = () => {};
      const timer = setTimeout(() => {
        off();
        reject(
          new Error(
            `The broker did not accept the connection again within ${this.timeoutMs} ms; the client keeps trying`,
          ),
        );
      }, this.timeoutMs);
      off = this.transport.onceConnect(() => {
        clearTimeout(timer);
        resolve();
      });
      this.transport.reconnect();
    });
  }
}
