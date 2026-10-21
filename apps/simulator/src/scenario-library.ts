import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseScenarioDocument, type ScenarioDocument } from './scenario-document.ts';
import type { DeviceSpec } from './signals.ts';

/** Custom scenarios, from files and from imports together. */
export const MAX_CUSTOM_SCENARIOS = 200;
/** The largest scenario file read: the same bound as a request body of the control server (16 KB). */
export const MAX_SCENARIO_FILE_BYTES = 16 * 1024;

export type ScenarioSource = 'built-in' | 'custom';

export interface LibraryEntry {
  scenario: ScenarioDocument;
  source: ScenarioSource;
  /** True for a custom scenario imported during this session: it is not in the folder and ends with the process. */
  imported: boolean;
}

/** A scenario that was not kept, and why. `file` is a file name, `built-in:<name>`, or the folder itself. */
export interface RejectedScenario {
  file: string;
  reason: string;
}

export interface FolderLoad {
  scenarios: { file: string; scenario: ScenarioDocument }[];
  rejected: RejectedScenario[];
}

/**
 * Reads the `*.json` files of a folder as scenario documents, once. It never throws: a folder that does not
 * exist means there are no custom scenarios, and a file that cannot be used is reported with its reason (as
 * `loadRules` does for `rules.json`) instead of stopping the simulator or being dropped without a word.
 */
export function loadScenarioFolder(
  dir: string,
  options: { devices: readonly DeviceSpec[] },
): FolderLoad {
  const loaded: FolderLoad = { scenarios: [], rejected: [] };

  let files: string[];
  try {
    files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // No folder is the normal state of a clone: only another failure (a file in its place, no permission) is said.
    if (code !== 'ENOENT') {
      loaded.rejected.push({
        file: dir,
        reason: `cannot read the folder${code ? ` (${code})` : ''}`,
      });
    }
    return loaded;
  }

  for (const file of files) {
    if (loaded.scenarios.length >= MAX_CUSTOM_SCENARIOS) {
      loaded.rejected.push({
        file,
        reason: `not loaded: the folder holds more than ${MAX_CUSTOM_SCENARIOS} scenarios`,
      });
      continue;
    }
    const path = join(dir, file);
    let text: string;
    try {
      if (statSync(path).size > MAX_SCENARIO_FILE_BYTES) {
        loaded.rejected.push({ file, reason: `larger than ${MAX_SCENARIO_FILE_BYTES} bytes` });
        continue;
      }
      text = readFileSync(path, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      loaded.rejected.push({ file, reason: `cannot read the file${code ? ` (${code})` : ''}` });
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      loaded.rejected.push({ file, reason: 'is not valid JSON' });
      continue;
    }
    const result = parseScenarioDocument(json, options);
    if (result.ok) loaded.scenarios.push({ file, scenario: result.scenario });
    else loaded.rejected.push({ file, reason: result.reason });
  }
  return loaded;
}

export type ImportResult =
  | { ok: true; entry: LibraryEntry }
  | { ok: false; kind: 'invalid' | 'taken' | 'full'; reason: string };

/**
 * Every scenario the simulator can run: the built-ins, the custom ones read from the folder at start, and the
 * ones imported during the session. Keyed by name in a `Map`, never in a plain object, because a name comes
 * from a request or a file (`constructor` and `__proto__` are names that every object already has).
 *
 * A scenario is kept only if it is valid for the registry in use: a document that names a device this registry
 * does not have is not a card that cannot run, it is a rejected file with the reason.
 */
export class ScenarioLibrary {
  /** What was not kept, from the built-ins and the folder, in the order met. */
  readonly rejected: RejectedScenario[] = [];
  private readonly entries = new Map<string, LibraryEntry>();
  private readonly devices: readonly DeviceSpec[];

  constructor(options: {
    builtIn: readonly ScenarioDocument[];
    folder?: FolderLoad;
    devices: readonly DeviceSpec[];
  }) {
    this.devices = options.devices;
    for (const document of options.builtIn) {
      const result = parseScenarioDocument(document, { devices: options.devices });
      if (!result.ok) {
        this.rejected.push({ file: `built-in:${document.name}`, reason: result.reason });
      } else if (this.entries.has(result.scenario.name)) {
        this.rejected.push({
          file: `built-in:${document.name}`,
          reason: `the name "${document.name}" is already used`,
        });
      } else {
        this.entries.set(result.scenario.name, {
          scenario: result.scenario,
          source: 'built-in',
          imported: false,
        });
      }
    }
    this.rejected.push(...(options.folder?.rejected ?? []));
    for (const { file, scenario } of options.folder?.scenarios ?? []) {
      if (this.entries.has(scenario.name)) {
        this.rejected.push({ file, reason: `the name "${scenario.name}" is already used` });
      } else {
        this.entries.set(scenario.name, { scenario, source: 'custom', imported: false });
      }
    }
  }

  get(name: string): LibraryEntry | undefined {
    return this.entries.get(name);
  }

  names(): string[] {
    return [...this.entries.keys()];
  }

  /** Built-ins first, then the folder's, then imports: the order they were added. */
  list(): LibraryEntry[] {
    return [...this.entries.values()];
  }

  counts(): { builtIn: number; custom: number; imported: number } {
    const all = this.list();
    return {
      builtIn: all.filter((entry) => entry.source === 'built-in').length,
      custom: all.filter((entry) => entry.source === 'custom' && !entry.imported).length,
      imported: all.filter((entry) => entry.imported).length,
    };
  }

  /**
   * Validates a document with the same checks as a file and keeps it for the session. Nothing is written to
   * disk. Refused when the document is invalid, when its name is taken, or when there are already
   * `MAX_CUSTOM_SCENARIOS` custom scenarios.
   */
  import(input: unknown): ImportResult {
    const result = parseScenarioDocument(input, { devices: this.devices });
    if (!result.ok) return { ok: false, kind: 'invalid', reason: result.reason };
    const { name } = result.scenario;
    if (this.entries.has(name)) {
      return { ok: false, kind: 'taken', reason: `a scenario named "${name}" already exists` };
    }
    const { custom, imported } = this.counts();
    if (custom + imported >= MAX_CUSTOM_SCENARIOS) {
      return {
        ok: false,
        kind: 'full',
        reason: `there are already ${MAX_CUSTOM_SCENARIOS} custom scenarios`,
      };
    }
    const entry: LibraryEntry = { scenario: result.scenario, source: 'custom', imported: true };
    this.entries.set(name, entry);
    return { ok: true, entry };
  }
}
