import { useCallback, useState } from 'react';
import {
  conflictsOf,
  deleteScenario,
  importScenario,
  runScenario,
  stopScenario,
} from '../../api/client';
import type { ImportAnswer, ReplacedRun, RunAnswer, RunConflict, StateView } from '../../api/types';
import { nameList, startedNotice } from '../../lib/scenarioStart';
import { useStudioStore } from '../../state/studioContext';

/** The most a scenario file may be: the same bound as a request the simulator accepts (16 KiB). */
export const MAX_IMPORT_BYTES = 16 * 1024;

/** What the page tells after a command: `ok` is a status, `bad` an alert. */
export interface CommandNotice {
  tone: 'ok' | 'bad';
  text: string;
}

/** A run the simulator refused because something is in the way, and what: asked about before it is repeated. */
export interface PendingReplace {
  name: string;
  conflicts: RunConflict[];
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const without = (record: Readonly<Record<string, string>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

/** An answer's state alone: the extras of a run or an import are not part of what the store holds. */
function stateOf(answer: RunAnswer | ImportAnswer): StateView {
  const view: Partial<RunAnswer & ImportAnswer> = { ...answer };
  delete view.runId;
  delete view.anomalyIds;
  delete view.startedDevices;
  delete view.replaced;
  delete view.scenario;
  return view as StateView;
}

function replacedNotice(replaced: readonly ReplacedRun[]): string | null {
  const runs = [
    ...new Set(replaced.flatMap((r) => (r.runId === null ? [] : [r.scenario ?? r.runId]))),
  ];
  const loose = replaced
    .filter((r) => r.runId === null)
    .reduce((sum, r) => sum + r.anomalyIds.length, 0);
  const parts = [
    ...(runs.length > 0 ? [nameList(runs)] : []),
    ...(loose > 0
      ? [`${loose} ${loose === 1 ? 'anomaly' : 'anomalies'} that no run of Studio started`]
      : []),
  ];
  return parts.length === 0 ? null : `Replaced ${parts.join(' and ')}.`;
}

/** "Running x. Started hub-power-01. Replaced y." */
function runNotice(name: string, answer: RunAnswer): string {
  return [`Running ${name}.`, startedNotice(answer.startedDevices), replacedNotice(answer.replaced)]
    .filter((part): part is string => part !== null)
    .join(' ');
}

export interface ScenarioCommandsOptions {
  /** Called after a command that may have changed what the cards say, so the page reads the library again. */
  onChanged(): void;
  /** Called with the name of a scenario that was imported, so the page can point at its card. */
  onImported(name: string): void;
}

/**
 * The commands a person can give a scenario, with what the page needs to show about them: which scenario is busy, what
 * the simulator said when it refused (on the card), and a notice for what worked (or for a file that was refused, which
 * belongs to no card). The answer to a command is the new state; it goes into the store at once.
 *
 * A run that the simulator refuses because an anomaly is in the way (`409` with its conflicts) is not an error: it is
 * parked as a pending replace, and the page asks before it repeats the run with `replace`.
 */
export function useScenarioCommands({ onChanged, onImported }: ScenarioCommandsOptions) {
  const store = useStudioStore();
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [notice, setNotice] = useState<CommandNotice | null>(null);
  const [pending, setPending] = useState<PendingReplace | null>(null);

  const track = useCallback(async (key: string, work: () => Promise<void>): Promise<void> => {
    setBusy((was) => new Set(was).add(key));
    try {
      await work();
    } finally {
      setBusy((was) => {
        const next = new Set(was);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const runWith = useCallback(
    (name: string, replace: boolean) =>
      track(`${name}:run`, async () => {
        let changed = true;
        try {
          const answer = await runScenario(name, { replace });
          store.getState().setView(stateOf(answer), Date.now());
          setErrors((was) => without(was, name));
          setPending(null);
          setNotice({ tone: 'ok', text: runNotice(name, answer) });
        } catch (error) {
          const conflicts = replace ? null : conflictsOf(error);
          if (conflicts !== null) {
            changed = false;
            setPending({ name, conflicts });
            setErrors((was) => without(was, name));
          } else {
            setPending(null);
            setErrors((was) => ({ ...was, [name]: message(error) }));
          }
        }
        if (changed) onChanged();
      }),
    [store, track, onChanged],
  );

  const stop = useCallback(
    (name: string) =>
      track(`${name}:stop`, async () => {
        try {
          store.getState().setView(await stopScenario(name), Date.now());
          setErrors((was) => without(was, name));
          setNotice({ tone: 'ok', text: `Stopped ${name}.` });
        } catch (error) {
          setErrors((was) => ({ ...was, [name]: message(error) }));
        }
        onChanged();
      }),
    [store, track, onChanged],
  );

  /** Removes a custom scenario and its file. The simulator refuses a built-in and a scenario that is running; its reason is shown on the card. */
  const remove = useCallback(
    (name: string) =>
      track(`${name}:delete`, async () => {
        try {
          store.getState().setView(await deleteScenario(name), Date.now());
          setErrors((was) => without(was, name));
          setNotice({ tone: 'ok', text: `Deleted ${name}.` });
        } catch (error) {
          setErrors((was) => ({ ...was, [name]: message(error) }));
        }
        onChanged();
      }),
    [store, track, onChanged],
  );

  const importFile = useCallback(
    (file: File) =>
      track('import', async () => {
        const refuse = (reason: string) =>
          setNotice({ tone: 'bad', text: `${file.name} was not imported: ${reason}` });
        if (file.size > MAX_IMPORT_BYTES) {
          refuse(`it is larger than ${MAX_IMPORT_BYTES / 1024} KiB.`);
          return;
        }
        let document: unknown;
        try {
          document = JSON.parse(await file.text());
        } catch {
          refuse('it is not valid JSON.');
          return;
        }
        try {
          const answer = await importScenario(document);
          store.getState().setView(stateOf(answer), Date.now());
          setNotice({ tone: 'ok', text: `Imported ${answer.scenario.name}.` });
          onChanged();
          onImported(answer.scenario.name);
        } catch (error) {
          refuse(message(error));
        }
      }),
    [store, track, onChanged, onImported],
  );

  return {
    /** True while a command of the scenario is on its way, or only `action` when given. */
    isBusy: (name: string, action?: 'run' | 'stop' | 'delete') =>
      action === undefined
        ? [...busy].some((key) => key.startsWith(`${name}:`))
        : busy.has(`${name}:${action}`),
    importing: busy.has('import'),
    /** What the simulator said about the scenario's last refused command, or `null`. */
    errorOf: (name: string): string | null => errors[name] ?? null,
    notice,
    dismissNotice: () => setNotice(null),
    pending,
    run: (name: string) => runWith(name, false),
    /** Repeats the parked run with `replace`. */
    confirmReplace: () => (pending === null ? Promise.resolve() : runWith(pending.name, true)),
    cancelReplace: () => setPending(null),
    stop,
    remove,
    importFile,
  };
}

export type ScenarioCommands = ReturnType<typeof useScenarioCommands>;
