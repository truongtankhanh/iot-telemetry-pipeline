/** Characters that mean the same thing to a POSIX shell with or without quotes. */
const PLAIN = /^[A-Za-z0-9_./:@%+=-]+$/;

/** The port a broker listens on unless the state says otherwise (`docs/telemetry-contract.md`, section 8). */
export const DEFAULT_BROKER_PORT = 1883;

/**
 * Quotes a word for a POSIX shell: single quotes, with each `'` inside written `'\''`. Nothing inside single quotes is
 * special (no `$()`, no backtick, no backslash), which matters because the simulator makes payloads with quotes and
 * newlines on purpose (the malformed kinds). A plain word is left as it is unless `always` is set.
 */
export function quoteShell(text: string, always = false): string {
  if (!always && PLAIN.test(text)) return text;
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

export interface MosquittoPubInput {
  topic: string;
  payload: string;
  /** The broker's port as the state says it; anything that is not a port gives the default. */
  port: number | null;
}

/**
 * The message as a `mosquitto_pub` command, as frame 06 draws it. The host is always `localhost`: the broker the
 * simulator reports can be a service name that only the simulator's network resolves, and the command is for a shell on
 * the machine that runs the broker.
 */
export function mosquittoPubCommand({ topic, payload, port }: MosquittoPubInput): string {
  const valid = port !== null && Number.isInteger(port) && port >= 1 && port <= 65535;
  return [
    `mosquitto_pub -h localhost -p ${valid ? port : DEFAULT_BROKER_PORT} -q 1 \\`,
    `  -t ${quoteShell(topic)} \\`,
    `  -m ${quoteShell(payload, true)}`,
  ].join('\n');
}
