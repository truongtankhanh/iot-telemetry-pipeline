import { EventEmitter } from 'node:events';

/** What Studio shows of the simulator's own connection to the MQTT broker. */
export interface BrokerState {
  /** The broker URL without credentials, path or query: safe to send to a browser. */
  url: string;
  /** The port in the URL, or the scheme's default; `null` when neither is known. */
  port: number | null;
  connected: boolean;
}

const DEFAULT_PORTS: Record<string, number> = {
  'mqtt:': 1883,
  'tcp:': 1883,
  'mqtts:': 8883,
  'ssl:': 8883,
  'tls:': 8883,
  'ws:': 80,
  'wss:': 443,
};

/**
 * Reduces a broker URL to what may be shown: scheme, host and port. A URL that does not parse is
 * shown as given, minus anything that looks like `user:password@`.
 */
export function describeBroker(raw: string): Pick<BrokerState, 'url' | 'port'> {
  try {
    const parsed = new URL(raw);
    // `localhost:1883` parses as a URL with the scheme `localhost:`; that is not a broker URL.
    if (parsed.hostname === '') throw new Error('no host');
    const explicit = parsed.port === '' ? undefined : Number(parsed.port);
    const port = explicit ?? DEFAULT_PORTS[parsed.protocol] ?? null;
    const shownPort = parsed.port === '' ? '' : `:${parsed.port}`;
    return { url: `${parsed.protocol}//${parsed.hostname}${shownPort}`, port };
  } catch {
    const url = raw.replace(/\/\/[^/@\s]*@/, '//');
    const port = /:(\d+)(?:[/?#]|$)/.exec(url)?.[1];
    return { url, port: port === undefined ? null : Number(port) };
  }
}

/**
 * Whether the simulator is connected to the broker, as a value the control server can report and
 * announce. `main.ts` feeds it from the MQTT client; the engine does not know about it. `change` is
 * emitted only when the value changes.
 */
export class BrokerLink extends EventEmitter<{ change: [BrokerState] }> {
  private readonly shown: Pick<BrokerState, 'url' | 'port'>;
  private connected: boolean;

  constructor(url: string, connected = false) {
    super();
    this.shown = describeBroker(url);
    this.connected = connected;
  }

  state(): BrokerState {
    return { ...this.shown, connected: this.connected };
  }

  setConnected(connected: boolean): void {
    if (connected === this.connected) return;
    this.connected = connected;
    this.emit('change', this.state());
  }
}
