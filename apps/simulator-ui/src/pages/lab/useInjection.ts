import { useCallback, useRef, useState } from 'react';
import { addAnomaly, ApiError, getState, removeAnomaly } from '../../api/client';
import type { Anomaly, AnomalyAnswer, StateView } from '../../api/types';
import { conflictSentence, engineConflicts, toRequests } from '../../lib/labFault';
import type { LabCommand } from '../../lib/labLog';
import { useStudioStore } from '../../state/studioContext';
import { useBulkRun } from '../fleet/useBulkRun';
import type { CommandNotice } from '../scenarios/useScenarioCommands';

/** Injected faults of which only some arrived: kept so that they can be taken out again. */
export interface PartialInjection {
  /** The engine's ids of the faults that did arrive. */
  ids: string[];
  ok: number;
  total: number;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** An answer's state alone: the id of an added anomaly is not part of what the store holds. */
function stateOf(answer: AnomalyAnswer): StateView {
  const view: Partial<AnomalyAnswer> = { ...answer };
  delete view.id;
  return view as StateView;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What the Lab does to the engine: injects a fault (_Inject now_) or the whole timeline (_Inject timeline_), and takes
 * faults out again. The simulator takes one anomaly per request, so a fault on many devices is sent one at a time with
 * progress (`useBulkRun`), and a failure on one device does not stop the rest.
 *
 * - **When it starts (decision D1).** The times are seconds from now; the engine's anomaly clock is read fresh just
 *   before the first request and every anomaly is sent with an absolute `startAt` on it, so a stagger keeps its spacing
 *   however long the requests take.
 * - **No overlap (decision D2).** The engine plays the first anomaly that matches and does not add two values, and the
 *   route does not check: against the fresh state, a fault that would overlap one on the engine is refused here, with
 *   the device's name, and nothing is sent.
 * - **The record.** The commands are kept in the page for the log (the simulator does not record Studio's clicks), and
 *   the engine's anomaly clock at the injection of a timeline is kept so the dock can draw its playhead.
 */
export function useInjection() {
  const store = useStudioStore();
  const { state: progress, run, cancel, dismiss } = useBulkRun();
  const [notice, setNotice] = useState<CommandNotice | null>(null);
  const [commands, setCommands] = useState<readonly LabCommand[]>([]);
  const [injectedBaseS, setInjectedBaseS] = useState<number | null>(null);
  const [partial, setPartial] = useState<PartialInjection | null>(null);
  const counter = useRef(0);

  const record = useCallback(
    (kind: LabCommand['kind'], text: string, devices: readonly string[]) => {
      counter.current += 1;
      setCommands((were) => [
        ...were,
        { id: String(counter.current), at: Date.now(), kind, text, devices },
      ]);
    },
    [],
  );

  const inject = useCallback(
    async (kind: 'inject' | 'timeline', anomalies: readonly Anomaly[]): Promise<boolean> => {
      if (anomalies.length === 0) return false;
      setNotice(null);
      setPartial(null);

      let fresh: StateView;
      try {
        fresh = await getState();
      } catch (error) {
        setNotice({ tone: 'bad', text: `The engine's clock could not be read: ${message(error)}` });
        return false;
      }
      store.getState().setView(fresh, Date.now());

      const conflicts = engineConflicts(anomalies, fresh.engine);
      if (conflicts.length > 0) {
        setNotice({ tone: 'bad', text: `Nothing was sent: ${conflictSentence(conflicts)}.` });
        return false;
      }

      const requests = toRequests(anomalies, fresh.engine.elapsedS);
      const added = new Map<number, string>();
      const results = await run(
        requests.map((_, index) => String(index)),
        'Injecting',
        async (index) => {
          const answer = await addAnomaly(requests[Number(index)]!);
          added.set(Number(index), answer.id);
          return stateOf(answer);
        },
      );
      if (results === null) return false;

      const arrived = results.filter((result) => result.ok).map((result) => Number(result.id));
      const devices = [...new Set(arrived.map((index) => anomalies[index]!.deviceId))];
      const first = anomalies[0]!;
      if (arrived.length > 0) {
        record(
          kind,
          kind === 'timeline'
            ? `Injected a timeline of ${plural(arrived.length, 'fault', 'faults')}`
            : `Injected a breach on ${plural(devices.length, 'device', 'devices')}: ${first.metric} → ${first.value}`,
          devices,
        );
        if (kind === 'timeline') setInjectedBaseS(fresh.engine.elapsedS);
      }

      const failed = results.filter((result) => !result.ok);
      if (failed.length === 0) {
        setNotice({ tone: 'ok', text: `Injected ${plural(arrived.length, 'fault', 'faults')}.` });
        return true;
      }
      setNotice({
        tone: 'bad',
        text: `${arrived.length} of ${requests.length} injected. ${failed[0]?.error ?? 'The simulator refused one.'}`,
      });
      if (arrived.length > 0) {
        setPartial({
          ids: arrived.map((index) => added.get(index)!),
          ok: arrived.length,
          total: requests.length,
        });
      }
      return false;
    },
    [store, run, record],
  );

  /** Takes faults out of the engine by their ids. One that is gone already counts as taken out. */
  const remove = useCallback(
    async (ids: readonly string[]): Promise<boolean> => {
      if (ids.length === 0) return false;
      setNotice(null);
      const results = await run(ids, 'Removing', async (id) => {
        try {
          return await removeAnomaly(id);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) return getState();
          throw error;
        }
      });
      if (results === null) return false;
      const removed = results.filter((result) => result.ok).length;
      if (removed > 0) record('remove', `Removed ${plural(removed, 'fault', 'faults')}`, []);
      setPartial(null);
      if (removed === ids.length) {
        setNotice({ tone: 'ok', text: `Removed ${plural(removed, 'fault', 'faults')}.` });
        return true;
      }
      const failed = results.find((result) => !result.ok);
      setNotice({
        tone: 'bad',
        text: `${removed} of ${ids.length} removed. ${failed?.error ?? 'The simulator refused one.'}`,
      });
      return false;
    },
    [run, record],
  );

  return {
    /** Progress of what is being sent, and the results of the last run. */
    progress,
    cancel,
    dismissProgress: dismiss,
    notice,
    dismissNotice: useCallback(() => setNotice(null), []),
    /** Faults of an injection that only partly arrived, to take out again. */
    partial,
    commands,
    /** The engine's anomaly clock when the timeline was injected in this window, or `null`. */
    injectedBaseS,
    injectNow: useCallback(
      (anomalies: readonly Anomaly[]) => inject('inject', anomalies),
      [inject],
    ),
    injectTimeline: useCallback(
      (anomalies: readonly Anomaly[]) => inject('timeline', anomalies),
      [inject],
    ),
    remove,
  };
}

export type Injection = ReturnType<typeof useInjection>;
