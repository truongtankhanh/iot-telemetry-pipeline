import { useCallback, useState } from 'react';
import { pauseDevice, resetEngine, startDevice, stepEngine } from '../../api/client';
import type { StateView } from '../../api/types';
import { BULK_CONFIRM_ABOVE, BULK_WORDS, type BulkAction } from '../../lib/bulk';
import { useStudio, useStudioStore } from '../../state/studioContext';
import { useBulkRun } from '../fleet/useBulkRun';
import type { PendingBulk } from '../fleet/BulkStatus';
import { type CommandNotice, useScenarioCommands } from '../scenarios/useScenarioCommands';
import { useScenarioLibrary } from '../scenarios/useScenarioLibrary';

/** The commands on the engine's clock and on the devices as a whole. */
export type ClockCommand = 'step' | 'reset';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Everything the Overview's controls do, apart from which scenario is picked (that is the address's):
 *
 * - `library` and `commands`: the scenario library and Run / Stop / Replace, exactly the Scenarios page's hooks, so a
 *   scenario is run in one way from wherever it is run. The library is read again after each command.
 * - `devices`: **Pause** pauses every running device and **Resume** starts every paused one (D8: no memory, so a
 *   reload does not lose it; a device someone paused by hand is resumed too, and the label says how many). It goes
 *   through the Fleet's bulk run (one device at a time, with progress), asks first above `BULK_CONFIRM_ABOVE`
 *   devices as the Fleet does, and leaves the scenario's clock alone: pausing devices does not pause a run.
 * - `clock`: **Step** and **Reset**. Step exists only on the simulated clock (`simulated`); the answer of both is the
 *   new state, which goes into the store at once.
 */
export function useSimulationControls() {
  const store = useStudioStore();
  const library = useScenarioLibrary();
  const commands = useScenarioCommands({
    onChanged: library.refresh,
    // The Overview has no import: a scenario is imported on the Scenarios page.
    onImported: () => {},
  });

  const simulated = useStudio((state) => state.view?.engine.simulated ?? false);
  const engineDevices = useStudio((state) => state.view?.engine.devices);
  const running = (engineDevices ?? []).filter((d) => d.state === 'running').map((d) => d.id);
  const paused = (engineDevices ?? []).filter((d) => d.state === 'paused').map((d) => d.id);

  // ---- the devices as a whole ----
  const bulk = useBulkRun();
  const [pending, setPending] = useState<PendingBulk | null>(null);
  const start = useCallback(
    (action: Extract<BulkAction, 'pause' | 'start'>, ids: string[]) => {
      setPending(null);
      void bulk.run(
        ids,
        BULK_WORDS[action].doing,
        action === 'pause' ? (id) => pauseDevice(id) : (id) => startDevice(id),
      );
    },
    [bulk],
  );
  const request = useCallback(
    (action: Extract<BulkAction, 'pause' | 'start'>, ids: string[]) => {
      if (ids.length === 0 || bulk.state.running) return;
      if (ids.length > BULK_CONFIRM_ABOVE) setPending({ action, ids });
      else start(action, ids);
    },
    [bulk.state.running, start],
  );

  // ---- the clock ----
  const [clockBusy, setClockBusy] = useState<ClockCommand | null>(null);
  const [clockNotice, setClockNotice] = useState<CommandNotice | null>(null);
  const clockCommand = useCallback(
    async (which: ClockCommand, send: () => Promise<StateView>, done: string | null) => {
      if (clockBusy !== null) return;
      setClockBusy(which);
      try {
        store.getState().setView(await send(), Date.now());
        setClockNotice(done === null ? null : { tone: 'ok', text: done });
      } catch (error) {
        // The simulator's own reason: "step needs the simulated clock; this engine runs on the wall clock".
        setClockNotice({ tone: 'bad', text: message(error) });
      } finally {
        setClockBusy(null);
      }
      // A reset ends the runs that were playing, which the library's `running` and its times depend on.
      library.refresh();
    },
    [clockBusy, library, store],
  );

  return {
    library,
    commands,
    devices: {
      /** Running devices Pause would pause, and paused ones Resume would start. */
      pausable: running.length,
      resumable: paused.length,
      /** Pause is absent on the simulated clock: nothing publishes by itself, so there is nothing to pause. */
      canPause: !simulated,
      state: bulk.state,
      pending,
      pause: () => request('pause', running),
      resume: () => request('start', paused),
      confirm: () => {
        if (pending !== null && (pending.action === 'pause' || pending.action === 'start')) {
          start(pending.action, pending.ids);
        }
      },
      cancelConfirm: () => setPending(null),
      cancelRun: bulk.cancel,
      dismiss: bulk.dismiss,
    },
    clock: {
      simulated,
      busy: clockBusy,
      notice: clockNotice,
      dismissNotice: () => setClockNotice(null),
      step: () => clockCommand('step', () => stepEngine(), null),
      reset: () =>
        clockCommand(
          'reset',
          () => resetEngine(),
          'Reset: anomalies and held values are cleared and the devices are back at their baseline.',
        ),
    },
  };
}

export type SimulationControls = ReturnType<typeof useSimulationControls>;
