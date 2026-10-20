import { readFileSync } from 'node:fs';
import type { DeviceSpec } from './signals.ts';

/** Where the engine's devices come from. Only a registry file today; the catalogue is V2-T05. */
export interface DeviceSource {
  load(): Promise<DeviceSpec[]>;
}

/** Reads the `devices` list of a `devices.json` registry (the ingest service's own file). */
export class JsonFileDeviceSource implements DeviceSource {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<DeviceSpec[]> {
    return (JSON.parse(readFileSync(this.path, 'utf8')) as { devices: DeviceSpec[] }).devices;
  }
}
