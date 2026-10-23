import { useCallback, useState } from 'react';
import type { FaultKind, FaultsSnapshot } from '../../api/types';
import { DEFAULT_DRAFTS, draftsFrom, type FaultDrafts } from '../../lib/faultSettings';

const KINDS: readonly FaultKind[] = [
  'drop',
  'duplicate',
  'malformed',
  'delay',
  'reorder',
  'link-loss',
];

/** What the engine has for each fault, as a string to compare: a change under the page is a change of this. */
function engineKeys(faults: FaultsSnapshot | null): Record<FaultKind, string> {
  const of = (value: unknown) => JSON.stringify(value ?? null);
  return {
    drop: of(faults?.drop),
    duplicate: of(faults?.duplicate),
    malformed: of(faults?.malformed),
    delay: of(faults?.delay),
    reorder: of(faults?.reorder),
    // When the link went down is not a setting: only the restore time is.
    'link-loss': of(faults?.linkLoss ? { forS: faults.linkLoss.forS } : null),
  };
}

/**
 * The values in the controls of the Faults page: what the person is editing, which is not yet what the engine has. The
 * engine is the truth for a fault that is on; the draft is what a slider shows while it is dragged and what a fault that is
 * off will be switched on with (the last values, or the defaults).
 *
 * A draft goes back to the engine's settings when the engine's settings for that fault change under it (another tab, a
 * command of this page that came back) and when a command is refused (`reset`), so the controls never keep a value that
 * the simulator turned down. A fault that is switched off keeps its draft. Drafts are not kept across a reload.
 */
export function useFaultDrafts(faults: FaultsSnapshot | null) {
  const [drafts, setDrafts] = useState<FaultDrafts>(() =>
    faults === null ? DEFAULT_DRAFTS : draftsFrom(faults),
  );
  const [seen, setSeen] = useState(() => engineKeys(faults));

  // Adjusting state while rendering, for the faults whose settings changed (the documented way to derive state from a prop).
  const now = engineKeys(faults);
  const changed = KINDS.filter((kind) => now[kind] !== seen[kind]);
  if (changed.length > 0) {
    setSeen(now);
    if (faults !== null) {
      const fresh = draftsFrom(faults, drafts);
      setDrafts((was) => {
        const next = { ...was };
        for (const kind of changed) Object.assign(next, { [kind]: fresh[kind] });
        return next;
      });
    }
  }

  const setDraft = useCallback(
    <K extends FaultKind>(kind: K, draft: FaultDrafts[K]) =>
      setDrafts((was) => ({ ...was, [kind]: draft })),
    [],
  );

  /** Puts a fault's draft back to what the engine has (or the last values, for a fault that is off). */
  const reset = useCallback(
    (kind: FaultKind) => {
      if (faults === null) return;
      setDrafts((was) => ({ ...was, [kind]: draftsFrom(faults, was)[kind] }));
    },
    [faults],
  );

  return { drafts, setDraft, reset };
}
