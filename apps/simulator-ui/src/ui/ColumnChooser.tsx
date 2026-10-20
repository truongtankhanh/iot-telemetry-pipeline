import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import styles from './controls.module.css';

export interface ChooserColumn {
  id: string;
  label: string;
  /** Always shown: its box is ticked and cannot be cleared (the column that names the row). */
  locked?: boolean;
}

export interface ColumnChooserProps {
  columns: readonly ChooserColumn[];
  /** Ids of the columns that are shown. */
  visible: ReadonlySet<string>;
  onChange: (visible: Set<string>) => void;
}

/**
 * A button that opens a list of checkboxes, one per column. A disclosure, not a menu: the list is in the page's tab
 * order right after the button, Esc closes it and puts focus back on the button, and so does a click elsewhere.
 */
export function ColumnChooser({ columns, visible, onChange }: ColumnChooserProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };

  const toggle = (id: string, on: boolean) => {
    const next = new Set(visible);
    if (on) next.add(id);
    else next.delete(id);
    onChange(next);
  };

  return (
    <div className={styles.chooser} ref={root} onKeyDown={onKeyDown}>
      <Button
        ref={button}
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        Columns
      </Button>
      {open ? (
        <div className={styles.panel} id={panelId} role="group" aria-label="Columns to show">
          {columns.map((column) => (
            <label key={column.id} className={styles.item}>
              <Checkbox
                label={column.label}
                checked={column.locked === true || visible.has(column.id)}
                disabled={column.locked === true}
                onChange={(on) => toggle(column.id, on)}
              />
              <span>{column.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
