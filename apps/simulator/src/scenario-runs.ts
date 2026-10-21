import type { ScenarioRunAnomaly } from './alert-cause.ts';
import type { Engine } from './engine.ts';
import type { ObservationDraft } from './observation-store.ts';
import { lengthS, type ScenarioDocument, toAnomalies } from './scenario-document.ts';

/** A scenario that Studio started and that is still playing. The client derives the elapsed time from `engine.elapsedS`. */
export interface ScenarioRunView {
  id: string;
  scenario: string;
  /** When the run was started (wall time, ISO 8601). */
  startedAt: string;
  /** The engine's anomaly clock (`elapsedS`) at second 0 of the scenario. */
  offsetS: number;
  /** The anomaly clock at the end of the scenario's last anomaly. */
  endsAtS: number;
  anomalyIds: string[];
  /** Devices the run found stopped or paused and started. */
  startedDevices: string[];
}

/** An anomaly in the engine that a new run would play over, and who owns it. */
export interface RunConflict {
  deviceId: string;
  anomalyId: string;
  /** `null` for an anomaly no run owns: the CLI's `--scenario`, or one added by hand. */
  runId: string | null;
  scenario: string | null;
}

/** What a run took out of the way: a whole earlier run, or the loose anomalies no run owns (`runId: null`). */
export interface ReplacedRun {
  runId: string | null;
  scenario: string | null;
  anomalyIds: string[];
}

export interface RunOutcome {
  run: ScenarioRunView;
  replaced: ReplacedRun[];
}

/** Thrown by `run` when the scenario would play over an anomaly that is active or still to come, and `replace` was not asked. */
export class ScenarioConflictError extends Error {
  readonly conflicts: RunConflict[];

  constructor(scenario: string, conflicts: RunConflict[]) {
    const devices = [...new Set(conflicts.map((conflict) => conflict.deviceId))].join(', ');
    super(
      `"${scenario}" would play over an anomaly that is active or coming on ${devices}; run it with replace to remove it`,
    );
    this.name = 'ScenarioConflictError';
    this.conflicts = conflicts;
  }
}

export interface ScenarioRunsOptions {
  engine: Engine;
  /** Stores an observation and tells the stream about it (`RoutesContext.record`). */
  record(draft: ObservationDraft): void;
  /** Wall clock, in milliseconds; not the engine's clock, which may be simulated. */
  now?: () => number;
}

/**
 * The scenarios Studio started, over the engine. A run is not stored state to keep in step with the engine: it
 * is the ids of the anomalies it added and the time it ends, and it is _active_ while the anomaly clock is before
 * that end and at least one of its anomalies is still in the engine. So running out of time, a stop, a reset and
 * a `DELETE /api/anomalies/:id` all end a run without any of them having to tell this class.
 *
 * In memory, for the life of the process, like the observation store.
 */
export class ScenarioRuns {
  private readonly engine: Engine;
  private readonly record: (draft: ObservationDraft) => void;
  private readonly now: () => number;
  private runs: ScenarioRunView[] = [];
  private readonly lastRun = new Map<string, string>();
  private nextRunId = 1;

  constructor(options: ScenarioRunsOptions) {
    this.engine = options.engine;
    this.record = options.record;
    this.now = options.now ?? Date.now;
  }

  /** The runs still playing, oldest first. */
  active(): ScenarioRunView[] {
    const { elapsedS, anomalies } = this.engine.snapshot();
    const present = new Set(anomalies.map((entry) => entry.id));
    return this.runs.filter(
      (run) => elapsedS < run.endsAtS && run.anomalyIds.some((id) => present.has(id)),
    );
  }

  /** When the scenario was last run in this session (ISO 8601), or `null`. */
  lastRunAt(name: string): string | null {
    return this.lastRun.get(name) ?? null;
  }

  /**
   * The anomalies in the engine, active or still to come, on a device the scenario uses: what it would play
   * over. An anomaly that has ended is not one, whoever owns it.
   */
  conflicts(scenario: ScenarioDocument): RunConflict[] {
    const { elapsedS, anomalies } = this.engine.snapshot();
    const devices = new Set(scenario.anomalies.map((anomaly) => anomaly.deviceId));
    return anomalies
      .filter(
        ({ anomaly }) =>
          devices.has(anomaly.deviceId) && anomaly.startAt + anomaly.duration > elapsedS,
      )
      .map(({ id, anomaly }) => {
        const owner = this.runs.find((run) => run.anomalyIds.includes(id));
        return {
          deviceId: anomaly.deviceId,
          anomalyId: id,
          runId: owner?.id ?? null,
          scenario: owner?.scenario ?? null,
        };
      });
  }

  /**
   * Plays the scenario from now: its "20 s in" is 20 s after the call. All or nothing: an anomaly the engine
   * refuses (an unknown device, say) rolls back the ones already added and changes nothing else.
   *
   * With `replace`, whatever it would play over is taken out first: a conflicting run is stopped as a whole (a
   * scenario cut in half is not the scenario), and an anomaly no run owns is removed alone. Without it, a
   * conflict throws `ScenarioConflictError` and nothing changes. Devices that are stopped or paused are started.
   */
  run(scenario: ScenarioDocument, options: { replace: boolean }): RunOutcome {
    const conflicts = this.conflicts(scenario);
    if (conflicts.length > 0 && !options.replace) {
      throw new ScenarioConflictError(scenario.name, conflicts);
    }

    const offsetS = this.engine.snapshot().elapsedS;
    const added: ScenarioRunAnomaly[] = [];
    try {
      for (const anomaly of toAnomalies(scenario)) {
        const startAt = anomaly.startAt + offsetS;
        const id = this.engine.addAnomaly({ ...anomaly, startAt });
        added.push({
          id,
          deviceId: anomaly.deviceId,
          metric: anomaly.metric,
          startAt,
          duration: anomaly.duration,
        });
      }
    } catch (error) {
      for (const { id } of added) this.engine.removeAnomaly(id);
      throw error;
    }

    const replaced = this.takeOut(conflicts);
    const startedDevices = this.startStopped(added.map((anomaly) => anomaly.deviceId));

    const run: ScenarioRunView = {
      id: `r${this.nextRunId++}`,
      scenario: scenario.name,
      startedAt: new Date(this.now()).toISOString(),
      offsetS,
      endsAtS: offsetS + lengthS(scenario),
      anomalyIds: added.map((anomaly) => anomaly.id),
      startedDevices,
    };
    // Runs that are over are forgotten here; what is left of them is the observation and `lastRun`.
    const live = new Set(this.active().map((candidate) => candidate.id));
    this.runs = [...this.runs.filter((earlier) => live.has(earlier.id)), run];
    this.lastRun.set(scenario.name, run.startedAt);

    for (const old of replaced) {
      if (old.runId !== null) {
        this.record({
          kind: 'scenario-stop',
          data: {
            name: old.scenario,
            runId: old.runId,
            anomalyIds: old.anomalyIds,
            reason: 'replaced',
          },
        });
      }
    }
    // The anomalies are kept with the run because the engine forgets them on a reset, and the cause of an alert
    // (`GET /api/alerts`) is worked out from the run, not from what the engine holds now.
    this.record({
      kind: 'scenario-run',
      data: {
        name: scenario.name,
        anomalyIds: run.anomalyIds,
        offsetS,
        anomalies: added,
        runId: run.id,
        startedDevices,
        replaced,
      },
    });
    return { run, replaced };
  }

  /**
   * Stops the active run of a scenario by removing its anomalies. Devices it started keep running, and an alert
   * it opened clears by itself once the value is back at its baseline. `undefined` when it is not running.
   */
  stop(name: string): ScenarioRunView | undefined {
    const run = this.active().find((candidate) => candidate.scenario === name);
    if (!run) return undefined;
    for (const id of run.anomalyIds) this.engine.removeAnomaly(id);
    this.record({
      kind: 'scenario-stop',
      data: { name, runId: run.id, anomalyIds: run.anomalyIds, reason: 'stopped' },
    });
    return run;
  }

  /** Removes the anomalies in the way, whole runs first; returns what was removed, by owner. */
  private takeOut(conflicts: RunConflict[]): ReplacedRun[] {
    const replaced: ReplacedRun[] = [];
    const loose: string[] = [];
    for (const runId of new Set(conflicts.map((conflict) => conflict.runId))) {
      if (runId === null) continue;
      const run = this.runs.find((candidate) => candidate.id === runId);
      if (!run) continue;
      for (const id of run.anomalyIds) this.engine.removeAnomaly(id);
      replaced.push({ runId: run.id, scenario: run.scenario, anomalyIds: run.anomalyIds });
    }
    for (const conflict of conflicts) {
      if (conflict.runId !== null) continue;
      if (this.engine.removeAnomaly(conflict.anomalyId)) loose.push(conflict.anomalyId);
    }
    if (loose.length > 0) replaced.push({ runId: null, scenario: null, anomalyIds: loose });
    return replaced;
  }

  /** Starts each of these devices that is stopped or paused; returns the ones it started, in the order given. */
  private startStopped(deviceIds: string[]): string[] {
    const states = new Map(
      this.engine.snapshot().devices.map((device) => [device.id, device.state]),
    );
    const started: string[] = [];
    for (const id of new Set(deviceIds)) {
      if (states.get(id) === 'running') continue;
      this.engine.startDevice(id);
      started.push(id);
    }
    return started;
  }
}
