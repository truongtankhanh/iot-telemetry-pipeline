import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { parseTwinSelection, type TwinSelection, writeTwinSelection } from '../../lib/twinQuery';

/**
 * The selection of the twin (a device or a building), read from and written to the address with the keys the Topology uses
 * (`device`, `zone`), so a reload and a shared link keep it and the _Topology | Twin_ switch carries it. A change replaces
 * the history entry: a selection is not a page to go back to. Every other parameter in the address (the event timeline
 * writes its own) is left as it is.
 */
export function useTwinParams(): [TwinSelection | null, (selection: TwinSelection | null) => void] {
  const [params, setParams] = useSearchParams();
  const parsed = parseTwinSelection(params);
  const type = parsed?.type;
  const id = parsed?.id;
  // The same object while the selection is the same: a change of another parameter must not look like a new selection.
  const selection = useMemo<TwinSelection | null>(
    () => (type === undefined || id === undefined ? null : { type, id }),
    [type, id],
  );

  const select = useCallback(
    (next: TwinSelection | null) =>
      setParams((current) => writeTwinSelection(current, next), { replace: true }),
    [setParams],
  );

  return [selection, select];
}
