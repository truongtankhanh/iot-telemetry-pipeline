import { useId } from 'react';
import { FAULT_TILES, type FaultTile } from '../../lib/labFault';
import { Icon } from '../../ui/Icon';
import { faultGlyphs } from '../../ui/icons';
import styles from './configuration.module.css';

export interface FaultTilesProps {
  value: FaultTile;
  onChange: (tile: FaultTile) => void;
}

/**
 * The nine kinds of fault of frame 12. Only a breach exists in the engine, so the other eight are drawn but cannot be
 * chosen, and one line under them says why (the reason is not left to a tooltip). Native radios underneath: the arrow
 * keys, the single tab stop and the announcement come from the browser, and a disabled tile is skipped by the keyboard.
 */
export function FaultTiles({ value, onChange }: FaultTilesProps) {
  const name = useId();
  const noteId = useId();
  return (
    <>
      <div className={styles.tiles} role="radiogroup" aria-label="Fault type">
        {FAULT_TILES.map((tile) => (
          <label
            key={tile.id}
            className={styles.tile}
            data-on={tile.id === value ? 'true' : undefined}
            data-disabled={tile.available ? undefined : 'true'}
            title={tile.reason ?? undefined}
          >
            <input
              type="radio"
              name={name}
              value={tile.id}
              checked={tile.id === value}
              disabled={!tile.available}
              aria-describedby={tile.available ? undefined : noteId}
              onChange={() => onChange(tile.id)}
            />
            <Icon glyph={faultGlyphs[tile.id]} />
            <span>{tile.label}</span>
          </label>
        ))}
      </div>
      <p id={noteId} className={styles.note}>
        Only a breach exists in the engine so far. The other faults come with SIM-12.
      </p>
    </>
  );
}
