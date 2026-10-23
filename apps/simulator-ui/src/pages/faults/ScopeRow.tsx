import { useMemo, useState } from 'react';
import type { FaultScope, FaultsSnapshot } from '../../api/types';
import type { FleetRow } from '../../lib/fleetQuery';
import { chosenDevices, deviceIdsOf, scopeSentence } from '../../lib/faultSettings';
import type { TargetScope } from '../../lib/labTargets';
import { Segmented } from '../../ui/Segmented';
import { TargetPicker } from '../lab/TargetPicker';
import styles from './faults.module.css';

export interface ScopeRowProps {
  faults: FaultsSnapshot;
  /** Every device of the registry with its state, as the Fleet builds them. */
  rows: readonly FleetRow[];
  busy: boolean;
  /** What the simulator said when it refused the scope. */
  error?: string | undefined;
  disabled: boolean;
  onScope: (scope: FaultScope) => void;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

/**
 * "Applies to" (frame 07): all running devices, or a selection, which is the Lab's own picker (device, zone or class, chips,
 * a popover). The engine's scope is a list of devices, so a zone or a class is expanded to its devices when it is sent, and
 * the picker keeps showing the zone the person chose. "Selected" with nothing chosen yet sends nothing (the simulator refuses
 * an empty selection): the picker opens and the line under it says so. The picker follows the engine when the engine's
 * selection changes under it (another tab).
 */
export function ScopeRow({ faults, rows, busy, error, disabled, onScope }: ScopeRowProps) {
  const devices = useMemo(() => rows.map((row) => row.device), [rows]);
  const engineIds = chosenDevices(faults.scope);
  const engineKey = `${faults.scope.mode}:${engineIds.join(',')}`;
  const [choice, setChoice] = useState<{ scope: TargetScope; targets: string[] }>({
    scope: 'device',
    targets: engineIds,
  });
  const [pending, setPending] = useState(false);
  const [seen, setSeen] = useState(engineKey);

  // The engine's selection changed (a command of this page that came back, or another tab): follow it unless the picker
  // already says the same devices, which would turn the zone the person chose into a list of devices.
  if (seen !== engineKey) {
    setSeen(engineKey);
    setPending(false);
    if (!sameSet(deviceIdsOf(devices, choice.scope, choice.targets), engineIds)) {
      setChoice({ scope: 'device', targets: engineIds });
    }
  }

  const selected = pending || faults.scope.mode === 'selected';
  const resolved = deviceIdsOf(devices, choice.scope, choice.targets);
  const frozen = disabled || busy;

  const choose = (mode: string) => {
    if (mode === 'running') {
      setPending(false);
      if (faults.scope.mode === 'selected') onScope({ mode: 'running' });
    } else if (faults.scope.mode !== 'selected') {
      setPending(true);
    }
  };

  const change = (targets: string[]) => {
    setChoice((was) => ({ ...was, targets }));
    const ids = deviceIdsOf(devices, choice.scope, targets);
    if (ids.length > 0) onScope({ mode: 'selected', deviceIds: ids });
  };

  return (
    <section className={styles.scope} aria-label="Scope">
      <div className={styles.scopeHead}>
        <span className={styles.lbl}>Applies to</span>
        <Segmented
          label="Applies to"
          value={selected ? 'selected' : 'running'}
          onChange={choose}
          options={[
            { value: 'running', label: 'All running', disabled: frozen },
            { value: 'selected', label: 'Selected', disabled: frozen },
          ]}
        />
      </div>
      {selected ? (
        <TargetPicker
          rows={rows}
          scope={choice.scope}
          targets={choice.targets}
          onScope={(scope) => setChoice({ scope, targets: [] })}
          onChange={change}
        />
      ) : null}
      <p className={styles.scopeNote}>{scopeSentence(faults)}</p>
      {selected && resolved.length === 0 ? (
        <p className={styles.scopeNote} role="status">
          Choose at least one device. Until then the simulator keeps its last choice.
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
