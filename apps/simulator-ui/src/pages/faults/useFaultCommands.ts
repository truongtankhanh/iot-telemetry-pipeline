import { useCallback, useState } from 'react';
import {
  ApiError,
  clearFault,
  clearFaults,
  resetFaultEffect,
  sendBurst,
  setFault,
  setFaultScope,
} from '../../api/client';
import type {
  BurstAnswer,
  FaultKind,
  FaultScope,
  FaultsSnapshot,
  StateView,
} from '../../api/types';
import {
  bodyOf,
  checkDraft,
  FAULT_LIMITS,
  type FaultDrafts,
  hasErrors,
  isCurrent,
} from '../../lib/faultSettings';
import { useStudioStore } from '../../state/studioContext';
import type { CommandNotice } from '../scenarios/useScenarioCommands';

const message = (error: unknown) =>
  error instanceof ApiError && error.status === 0
    ? 'The simulator did not answer'
    : error instanceof Error
      ? error.message
      : String(error);

/** An answer's state alone: how many messages a burst sent is not part of what the store holds. */
function stateOf(answer: StateView | BurstAnswer): StateView {
  const view: Partial<BurstAnswer> = { ...answer };
  delete view.sent;
  delete view.failed;
  return view as StateView;
}

const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** Where an error is shown: under the control of that fault, or of the scope, the burst, Clear all, Reset counters. */
export type CommandKey = FaultKind | 'scope' | 'burst' | 'clear' | 'effect';

/**
 * The commands of the Faults page, with what the page needs to show about them: which control is busy, what the simulator
 * said when it refused (under that control), and a notice for what worked and has no control of its own to show it (a burst,
 * Clear all, Reset counters). The answer to a command is the new state and goes into the store at once; the page reads the
 * engine's faults from there, so a switch is on when the engine says so and not when the click happened.
 *
 * A command that sets something answers whether it was accepted, so the caller can put the draft back when it was not. A
 * command that changes nothing (the engine has exactly this) is not sent, and counts as accepted.
 */
export function useFaultCommands(faults: FaultsSnapshot | null) {
  const store = useStudioStore();
  const [busy, setBusy] = useState<ReadonlySet<CommandKey>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Partial<Record<CommandKey, string>>>>({});
  const [notice, setNotice] = useState<CommandNotice | null>(null);

  const run = useCallback(
    async <T extends StateView>(
      key: CommandKey,
      work: () => Promise<T>,
      done?: (answer: T) => CommandNotice,
    ): Promise<boolean> => {
      setBusy((was) => new Set(was).add(key));
      try {
        const answer = await work();
        store.getState().setView(stateOf(answer), Date.now());
        setErrors((was) => ({ ...was, [key]: undefined }));
        if (done) setNotice(done(answer));
        return true;
      } catch (error) {
        setErrors((was) => ({ ...was, [key]: message(error) }));
        return false;
      } finally {
        setBusy((was) => {
          const next = new Set(was);
          next.delete(key);
          return next;
        });
      }
    },
    [store],
  );

  /** Switches a fault on, or changes its settings, with the values in its controls. */
  const apply = useCallback(
    async <K extends FaultKind>(kind: K, draft: FaultDrafts[K]): Promise<boolean> => {
      if (hasErrors(checkDraft(kind, draft))) return false;
      const body = bodyOf(kind, draft);
      if (faults !== null && isCurrent(kind, body, faults)) return true;
      return run(kind, () => setFault(kind, body));
    },
    [faults, run],
  );

  const turnOff = useCallback((kind: FaultKind) => run(kind, () => clearFault(kind)), [run]);

  /** Never sends an empty selection: "Selected" with no device chosen yet waits for one. */
  const setScope = useCallback(
    async (scope: FaultScope): Promise<boolean> => {
      if (scope.mode === 'selected' && scope.deviceIds.length === 0) return false;
      return run('scope', () => setFaultScope(scope));
    },
    [run],
  );

  const burst = useCallback(
    () =>
      run(
        'burst',
        () => sendBurst(FAULT_LIMITS.burst),
        (answer) => ({
          tone: answer.failed > 0 ? 'bad' : 'ok',
          text: `Sent ${count(answer.sent, 'message', 'messages')}, ${answer.failed.toLocaleString('en-US')} failed.`,
        }),
      ),
    [run],
  );

  const clearAll = useCallback(
    () =>
      run(
        'clear',
        () => clearFaults(),
        () => ({
          tone: 'ok',
          text: 'All faults cleared. Held messages were sent and the link is restored.',
        }),
      ),
    [run],
  );

  const resetEffect = useCallback(
    () =>
      run(
        'effect',
        () => resetFaultEffect(),
        () => ({
          tone: 'ok',
          text: 'The counters start again from now.',
        }),
      ),
    [run],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    busy,
    errors,
    notice,
    apply,
    turnOff,
    setScope,
    burst,
    clearAll,
    resetEffect,
    dismissNotice,
  };
}
