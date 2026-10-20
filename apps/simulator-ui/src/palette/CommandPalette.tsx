import { useEffect, useId, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { buildPaletteItems, type PaletteItem } from '../lib/paletteItems';
import type { AppRoute } from '../lib/routes';
import { useStudio, useStudioStore } from '../state/studioContext';
import { Icon } from '../ui/Icon';
import { uiIcons } from '../ui/icons';
import { Kbd } from '../ui/Kbd';
import styles from './palette.module.css';
import { useCommandPalette } from './useCommandPalette';

/**
 * Search and go-to (frame 17): pages, devices, zones, alerts, scenarios, topics and actions, found in the
 * browser from lists Studio already holds. It is a modal dialog over the page, which stays where it is
 * until a result is chosen. Nothing is mounted while it is closed, so the query starts empty each time.
 */
export function CommandPalette({ routes }: { routes: AppRoute[] }) {
  const open = useStudio((state) => state.paletteOpen);
  const view = useStudio((state) => state.view);
  const store = useStudioStore();
  const navigate = useNavigate();
  const items = useMemo(() => buildPaletteItems({ view, routes }), [view, routes]);

  if (!open) return null;
  return createPortal(
    <PaletteDialog
      items={items}
      onChoose={(item) => item.target && navigate(item.target)}
      onClose={() => store.getState().setPaletteOpen(false)}
    />,
    document.body,
  );
}

function PaletteDialog({
  items,
  onChoose,
  onClose,
}: {
  items: PaletteItem[];
  onChoose: (item: PaletteItem) => void;
  onClose: () => void;
}) {
  const palette = useCommandPalette({ items, onChoose, onClose });
  const inputRef = useRef<HTMLInputElement>(null);
  // Where focus was when the palette opened: it goes back there on Esc, as the page behind never moved.
  const opener = useRef<Element | null>(document.activeElement);
  const listId = useId();
  const active = palette.entries[palette.activeIndex];

  useEffect(() => {
    inputRef.current?.focus();
    const returnTo = opener.current;
    return () => {
      if (returnTo instanceof HTMLElement) returnTo.focus();
    };
  }, []);

  useEffect(() => {
    if (active) document.getElementById(active.id)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <div className={styles.scrim} onMouseDown={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Search and go to"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // One field to type in; keep focus there instead of letting Tab walk out of the dialog.
          if (event.key === 'Tab') event.preventDefault();
        }}
      >
        <div className={styles.field}>
          <Icon glyph={uiIcons.search} />
          <input
            ref={inputRef}
            className={styles.input}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active?.id}
            aria-label="Search devices, alerts, scenarios and pages"
            placeholder="Search devices, alerts, scenarios…"
            autoComplete="off"
            spellCheck={false}
            value={palette.query}
            onChange={(event) => palette.setQuery(event.target.value)}
            onKeyDown={palette.onKeyDown}
          />
          <span className={styles.count} role="status">
            {palette.total === 1 ? '1 result' : `${palette.total} results`}
          </span>
          <Kbd>Esc</Kbd>
        </div>

        <div id={listId} className={styles.list} role="listbox" aria-label="Results">
          {palette.sections.map((section) => (
            <div
              key={section.group}
              role="group"
              aria-label={section.label}
              className={styles.group}
            >
              <div className={styles.heading} aria-hidden="true">
                {section.label}
              </div>
              {section.entries.map((entry) => {
                const index = palette.entries.indexOf(entry);
                const selected = index === palette.activeIndex;
                return (
                  <div
                    key={entry.id}
                    id={entry.id}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={
                      entry.kind === 'item' && entry.item.disabled !== null ? true : undefined
                    }
                    className={styles.option}
                    data-active={selected ? 'true' : undefined}
                    data-kind={entry.kind}
                    onMouseMove={() => !selected && palette.setActiveIndex(index)}
                    onClick={() => palette.choose(entry, false)}
                  >
                    {entry.kind === 'more' ? (
                      <span>
                        Show all <b>{entry.hidden + section.entries.length - 1}</b> in{' '}
                        {section.label.toLowerCase()}
                      </span>
                    ) : (
                      <>
                        <span className={entry.item.group === 'pages' ? styles.label : styles.mono}>
                          {entry.item.label}
                        </span>
                        {entry.item.detail ? (
                          <span className={styles.detail}>{entry.item.detail}</span>
                        ) : null}
                      </>
                    )}
                    {selected && entry.kind === 'item' && entry.item.disabled === null ? (
                      <Kbd>↵</Kbd>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
          {palette.sections.length === 0 ? (
            <p className={styles.empty}>Nothing matches “{palette.query.trim()}”.</p>
          ) : null}
        </div>

        <div className={styles.footer}>
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>↵</Kbd> open
          </span>
          <span>
            <Kbd>⌘ ↵</Kbd> open in the background
          </span>
          <span className={styles.prefixes}>
            Prefix: <Kbd>d:</Kbd> <Kbd>a:</Kbd> <Kbd>s:</Kbd> <Kbd>&gt;</Kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
