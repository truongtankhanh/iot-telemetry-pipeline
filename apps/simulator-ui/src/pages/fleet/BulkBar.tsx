import type { BulkAction } from '../../lib/bulk';
import { Button } from '../../ui/Button';
import { uiIcons } from '../../ui/icons';
import styles from './bulk.module.css';

export interface BulkBarProps {
  /** Devices selected, wherever they are in the list. */
  selectedCount: number;
  /** How many of them are on the page on show. */
  onPageCount: number;
  /** How many devices pass the filters: what "Select all" would select. */
  filteredTotal: number;
  /** A run is going; the actions wait for it. */
  busy: boolean;
  /** A benchmark is running: the simulator refuses to start a device, so Start is off (Pause, Stop and Hold stay open). */
  startLocked?: boolean;
  onRun: (action: BulkAction) => void;
  onHold: () => void;
  onSelectAll: () => void;
  onClear: () => void;
}

/**
 * What can be done to the selected devices (frame 18): pause, start, stop, hold a value, select all, clear. It
 * appears when something is selected, and says how many, so "Stop" is never pressed on a number nobody read.
 * Progress, the confirmation above ten devices and the result are `BulkStatus`'s.
 */
export function BulkBar({
  selectedCount,
  onPageCount,
  filteredTotal,
  busy,
  startLocked = false,
  onRun,
  onHold,
  onSelectAll,
  onClear,
}: BulkBarProps) {
  if (selectedCount === 0) return null;
  const devices = `${selectedCount} selected ${selectedCount === 1 ? 'device' : 'devices'}`;
  return (
    <div className={styles.bar} role="region" aria-label="Actions for the selected devices">
      <span className={styles.count}>
        <b>{selectedCount}</b> selected
        {onPageCount !== selectedCount ? ` · ${onPageCount} on this page` : ' on this page'}
      </span>
      <Button
        size="sm"
        variant="outline"
        icon={uiIcons.pause}
        disabled={busy}
        aria-label={`Pause ${devices}`}
        onClick={() => onRun('pause')}
      >
        Pause
      </Button>
      <Button
        size="sm"
        variant="outline"
        icon={uiIcons.play}
        disabled={busy || startLocked}
        aria-label={`Start ${devices}`}
        onClick={() => onRun('start')}
      >
        Start
      </Button>
      <Button
        size="sm"
        variant="outline"
        icon={uiIcons.stop}
        disabled={busy}
        aria-label={`Stop ${devices}`}
        onClick={() => onRun('stop')}
      >
        Stop
      </Button>
      <Button size="sm" variant="outline" disabled={busy} aria-haspopup="dialog" onClick={onHold}>
        Hold value…
      </Button>
      <span className={styles.end}>
        {selectedCount < filteredTotal ? (
          <Button size="sm" variant="ghost" onClick={onSelectAll}>
            {`Select all ${filteredTotal}`}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear
        </Button>
      </span>
    </div>
  );
}
