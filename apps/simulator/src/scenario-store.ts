import { existsSync, mkdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ScenarioDocument } from './scenario-document.ts';

/**
 * The largest scenario file read or written: the same bound as a request body of the control server (16 KB). It lives
 * here, not in the library, so that the library can import the store without the store importing the library.
 */
export const MAX_SCENARIO_FILE_BYTES = 16 * 1024;

/** Why a scenario could not be written or removed. */
export type ScenarioStoreFailure = 'too-large' | 'file-exists' | 'unwritable';

/** The reason is a sentence for the person who asked, and the message of the control API's refusal. */
export class ScenarioStoreError extends Error {
  readonly kind: ScenarioStoreFailure;

  constructor(kind: ScenarioStoreFailure, reason: string) {
    super(reason);
    this.name = 'ScenarioStoreError';
    this.kind = kind;
  }
}

/**
 * Where custom scenarios are kept between runs of the simulator. The library asks it to write or remove a file and
 * changes its own list only if the answer is yes, so a failed save changes nothing. A fake in the library's tests,
 * a folder in `main.ts`.
 */
export interface ScenarioStore {
  /**
   * Writes the document to `file`. Without `replace` the file must not exist yet: a file in the folder that the
   * library did not load (it was rejected, or its name was taken) or that holds another scenario is somebody's
   * data, not a free name.
   * Throws `ScenarioStoreError`.
   */
  save(file: string, scenario: ScenarioDocument, options: { replace: boolean }): void;
  /** Removes `file`; a file that is already gone is not an error. Throws `ScenarioStoreError`. */
  remove(file: string): void;
}

/**
 * The text of a scenario file: two-space JSON with a fixed key order and a final newline, so that saving the same
 * scenario twice gives the same bytes and a change to one anomaly is a small diff in git.
 */
export function serializeScenario(scenario: ScenarioDocument): string {
  const ordered = {
    name: scenario.name,
    description: scenario.description,
    anomalies: scenario.anomalies.map(({ deviceId, metric, value, startAt, duration, shape }) => ({
      deviceId,
      metric,
      value,
      startAt,
      duration,
      ...(shape === undefined ? {} : { shape }),
    })),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** The error code of a failed filesystem call, for the reason ("EROFS", "EACCES"…). */
function codeOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code ? ` (${code})` : '';
}

/**
 * Scenario files in one folder. Writes are atomic (a temporary file next to the target, then a rename), so the next
 * start never reads half a file. The folder is created when it is missing.
 */
export class FolderScenarioStore implements ScenarioStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  /**
   * The path of a file in the folder. The library only passes `<name>.json` for a name the validator accepted (no
   * dot, no slash, no capital) or the name of a file the folder listing returned; this refuses anything else anyway,
   * because this is the one place that writes to disk.
   */
  private pathOf(file: string): string {
    if (
      file !== basename(file) ||
      /[\\/\0]/.test(file) ||
      !file.endsWith('.json') ||
      file === '.json'
    ) {
      throw new ScenarioStoreError('unwritable', `"${file}" is not a scenario file name`);
    }
    return join(this.dir, file);
  }

  save(file: string, scenario: ScenarioDocument, options: { replace: boolean }): void {
    const path = this.pathOf(file);
    const text = serializeScenario(scenario);
    const bytes = Buffer.byteLength(text);
    // Checked before anything is written: a file over the limit is rejected when the simulator starts, so a save that
    // succeeded would make the scenario vanish at the next restart.
    if (bytes > MAX_SCENARIO_FILE_BYTES) {
      throw new ScenarioStoreError(
        'too-large',
        `the scenario is ${bytes} bytes as a file, more than the ${MAX_SCENARIO_FILE_BYTES} a scenario file may have`,
      );
    }

    const temporary = `${path}.tmp`;
    try {
      mkdirSync(this.dir, { recursive: true });
      if (!options.replace && existsSync(path)) {
        throw new ScenarioStoreError(
          'file-exists',
          `a file named ${file} is already in the scenarios folder and holds another scenario or was not loaded (see "rejected"); it is not overwritten`,
        );
      }
      writeFileSync(temporary, text);
      renameSync(temporary, path);
    } catch (error) {
      // Best effort: when the folder itself is the problem (a file in its place) even `force` cannot remove a path
      // under it, and that must not hide the reason for the failure.
      try {
        rmSync(temporary, { force: true });
      } catch {
        // nothing to clean up
      }
      if (error instanceof ScenarioStoreError) throw error;
      throw new ScenarioStoreError(
        'unwritable',
        `cannot write ${file} in the scenarios folder${codeOf(error)}`,
      );
    }
  }

  remove(file: string): void {
    const path = this.pathOf(file);
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw new ScenarioStoreError(
        'unwritable',
        `cannot remove ${file} from the scenarios folder${codeOf(error)}`,
      );
    }
  }
}
