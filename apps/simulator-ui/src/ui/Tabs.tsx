import { type KeyboardEvent, useRef } from 'react';
import styles from './controls.module.css';
import { tabId } from './tabId';

export interface TabItem {
  id: string;
  label: string;
  /** A number shown beside the label ("Running 27"). */
  count?: number;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Names the group for a screen reader ("State"). */
  label: string;
  /** Prefix of the tab ids, so a panel can name its tab (`aria-labelledby={tabId(idPrefix, value)}`). */
  idPrefix: string;
  /** The id of the panel the tabs switch, which carries `role="tabpanel"`. */
  panelId?: string;
}

/**
 * Tabs that switch what a panel shows (the state tabs of the Fleet table, the metric tabs of a card). One tab is in
 * the tab order; the arrow keys, Home and End move between them and select as they go, since the panel is already
 * on the page and switching is cheap.
 */
export function Tabs({ tabs, value, onChange, label, idPrefix, panelId }: TabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = tabs[target];
    if (!next) return;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };

  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) refs.current.set(tab.id, element);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            className={styles.tab}
            aria-selected={selected}
            aria-controls={selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => move(event, index)}
          >
            {tab.label}
            {tab.count === undefined ? null : <span className={styles.count}>{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
