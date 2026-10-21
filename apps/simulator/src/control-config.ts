import { isIPv4 } from 'node:net';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The settings of the control server, resolved and checked. */
export interface ControlConfig {
  /** Address the server listens on. */
  host: string;
  port: number;
  /** Base URL of ingest, without a trailing slash. */
  ingestUrl: string;
  /** Base URL of the command center console, without a trailing slash; `null` when none is set. */
  consoleUrl: string | null;
  /** Absolute path of the directory with the built Studio UI (it may not exist: the UI is not built by every script). */
  studioDir: string;
  /** Absolute path of the folder with custom scenario files, read at start (it may not exist: that means none). */
  scenariosDir: string;
  /** True when `CONTROL_ALLOW_NON_LOOPBACK=true` let a non-loopback `host` through. */
  allowNonLoopback: boolean;
}

/** What the command line may override. A flag that was not given is `undefined`. */
export interface ControlFlags {
  controlHost?: string | undefined;
  controlPort?: string | undefined;
  ingestUrl?: string | undefined;
  studioDir?: string | undefined;
  scenariosDir?: string | undefined;
}

/** A setting is wrong or refused. The message names the setting to change. */
export class ControlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ControlConfigError';
  }
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3200;
const DEFAULT_INGEST_URL = 'http://localhost:3100';
/** `apps/simulator-ui/dist`, from `apps/simulator/src`. The image sets `STUDIO_DIR` itself. */
export const DEFAULT_STUDIO_DIR = fileURLToPath(
  new URL('../../simulator-ui/dist', import.meta.url),
);
/** `apps/simulator/scenarios`, from `apps/simulator/src`; the repository does not create it. */
export const DEFAULT_SCENARIOS_DIR = fileURLToPath(new URL('../scenarios', import.meta.url));

/**
 * True for the addresses that cannot be reached from another machine: `localhost`, any `127.x.y.z`
 * and `::1`. `0.0.0.0` and `::` (every interface), a LAN address and any other name are not.
 */
export function isLoopbackHost(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (name === 'localhost' || name === '::1' || name === '0:0:0:0:0:0:0:1') return true;
  return isIPv4(name) && name.startsWith('127.');
}

/** The first value that is not empty: a blank line in a `.env` file means "not set". */
function firstSet(...candidates: [value: string | undefined, where: string][]) {
  for (const [value, where] of candidates) {
    if (value !== undefined && value.trim() !== '') return { value: value.trim(), where };
  }
  return undefined;
}

function parseHttpUrl(value: string, where: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ControlConfigError(`${where} must be an http or https URL, got "${value}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ControlConfigError(`${where} must be an http or https URL, got "${value}"`);
  }
  return url.href.replace(/\/+$/, '');
}

function parsePort(value: string, where: string): number {
  const port = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ControlConfigError(`${where} must be an integer from 1 to 65535, got "${value}"`);
  }
  return port;
}

/**
 * Reads the control server's settings: the environment first, a flag overriding it, as `MQTT_URL`
 * and `--broker` do. Throws a `ControlConfigError` for a value that cannot be used, and for a
 * non-loopback `CONTROL_HOST` unless `CONTROL_ALLOW_NON_LOOPBACK` is exactly `true`: the control API
 * has no authentication, so listening beyond this machine has to be asked for.
 */
export function resolveControlConfig(input: {
  env: Record<string, string | undefined>;
  flags?: ControlFlags;
}): ControlConfig {
  const { env, flags = {} } = input;

  const host = firstSet(
    [flags.controlHost, '--control-host'],
    [env.CONTROL_HOST, 'CONTROL_HOST'],
  ) ?? { value: DEFAULT_HOST, where: 'CONTROL_HOST' };
  const portSetting = firstSet(
    [flags.controlPort, '--control-port'],
    [env.CONTROL_PORT, 'CONTROL_PORT'],
  );
  const ingestSetting = firstSet([flags.ingestUrl, '--ingest-url'], [env.INGEST_URL, 'INGEST_URL']);
  const consoleSetting = firstSet([env.OCC_CONSOLE_URL, 'OCC_CONSOLE_URL']);
  const studioSetting = firstSet([flags.studioDir, '--studio-dir'], [env.STUDIO_DIR, 'STUDIO_DIR']);
  const scenariosSetting = firstSet(
    [flags.scenariosDir, '--scenarios-dir'],
    [env.SCENARIOS_DIR, 'SCENARIOS_DIR'],
  );
  const allowNonLoopback = env.CONTROL_ALLOW_NON_LOOPBACK === 'true';

  if (!isLoopbackHost(host.value) && !allowNonLoopback) {
    throw new ControlConfigError(
      `Refusing to listen on "${host.value}" (${host.where}): it is not a loopback address and the control API has no authentication. ` +
        'Use 127.0.0.1, or set CONTROL_ALLOW_NON_LOOPBACK=true if exposing it is intended ' +
        '(for example in a container whose published port is limited to 127.0.0.1).',
    );
  }

  return {
    host: host.value,
    port: portSetting ? parsePort(portSetting.value, portSetting.where) : DEFAULT_PORT,
    ingestUrl: ingestSetting
      ? parseHttpUrl(ingestSetting.value, ingestSetting.where)
      : DEFAULT_INGEST_URL,
    consoleUrl: consoleSetting ? parseHttpUrl(consoleSetting.value, consoleSetting.where) : null,
    studioDir: studioSetting ? resolvePath(studioSetting.value) : DEFAULT_STUDIO_DIR,
    scenariosDir: scenariosSetting ? resolvePath(scenariosSetting.value) : DEFAULT_SCENARIOS_DIR,
    allowNonLoopback,
  };
}
