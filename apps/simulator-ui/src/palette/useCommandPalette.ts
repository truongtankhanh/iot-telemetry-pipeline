import { type KeyboardEvent, useMemo, useState } from 'react';
import { matchPalette } from '../lib/palette';
import { GROUP_LABELS, type PaletteGroup, type PaletteItem } from '../lib/paletteItems';

/** What the keyboard can land on: a result, or "Show all" at the end of a group that was cut at five. */
export type PaletteEntry =
  | { kind: 'item'; id: string; item: PaletteItem }
  | { kind: 'more'; id: string; group: PaletteGroup; hidden: number };

export interface PaletteSection {
  group: PaletteGroup;
  label: string;
  entries: PaletteEntry[];
}

export interface UseCommandPalette {
  query: string;
  setQuery: (query: string) => void;
  sections: PaletteSection[];
  /** Every entry in the order the arrow keys move through them. */
  entries: PaletteEntry[];
  total: number;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** The key handler of the search field: arrows, Home, End, Enter, ⌘ Enter and Escape. */
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  choose: (entry: PaletteEntry | undefined, keepOpen: boolean) => void;
}

/**
 * The state of the palette: the query, which groups were expanded, which result is active, and what a key
 * does. The matching itself is `lib/palette.ts`; this only turns it into rows a screen can draw and a
 * keyboard can walk. Choosing a result goes to its page and closes the palette; `⌘ Enter` goes and leaves it
 * open ("open in the background"). A result that cannot be chosen yet (an action) does nothing.
 */
export function useCommandPalette({
  items,
  onChoose,
  onClose,
}: {
  items: PaletteItem[];
  onChoose: (item: PaletteItem) => void;
  onClose: () => void;
}): UseCommandPalette {
  const [query, setQueryState] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<PaletteGroup>>(() => new Set());
  const [rawActive, setActiveIndex] = useState(0);

  const matches = useMemo(() => matchPalette(items, query, { expanded }), [items, query, expanded]);

  const { sections, entries } = useMemo(() => {
    let index = 0;
    const built: PaletteSection[] = matches.groups.map((group) => {
      const rows: PaletteEntry[] = group.items.map((item) => ({
        kind: 'item',
        id: `palette-option-${index++}`,
        item,
      }));
      if (group.hidden > 0) {
        rows.push({
          kind: 'more',
          id: `palette-option-${index++}`,
          group: group.group,
          hidden: group.hidden,
        });
      }
      return { group: group.group, label: GROUP_LABELS[group.group], entries: rows };
    });
    return { sections: built, entries: built.flatMap((section) => section.entries) };
  }, [matches]);

  const activeIndex = Math.min(rawActive, Math.max(0, entries.length - 1));

  const setQuery = (next: string) => {
    setQueryState(next);
    setExpanded(new Set());
    setActiveIndex(0);
  };

  const choose = (entry: PaletteEntry | undefined, keepOpen: boolean) => {
    if (!entry) return;
    if (entry.kind === 'more') {
      setExpanded((previous) => new Set(previous).add(entry.group));
      return;
    }
    if (entry.item.disabled !== null || entry.item.target === null) return;
    onChoose(entry.item);
    if (!keepOpen) onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = entries.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(entries.length === 0 ? 0 : activeIndex >= last ? 0 : activeIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(entries.length === 0 ? 0 : activeIndex <= 0 ? last : activeIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(Math.max(0, last));
        break;
      case 'Enter':
        event.preventDefault();
        choose(entries[activeIndex], event.metaKey || event.ctrlKey);
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
    }
  };

  return {
    query,
    setQuery,
    sections,
    entries,
    total: matches.total,
    activeIndex,
    setActiveIndex,
    onKeyDown,
    choose,
  };
}
