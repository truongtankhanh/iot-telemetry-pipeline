import { type EditorDoc, isDirty, type ScenarioDocument } from '../lib/timelineEditor';

/**
 * The timeline editor's working copies, kept for the session outside React (decision Q2). The router cannot block a
 * navigation inside the app (it is not a data router), so leaving the editor and coming back must not lose what was typed: a
 * copy lives here until it is saved, discarded or the page is reloaded. One copy for each scenario being edited, each new
 * scenario and each duplicate, under a key from `draftKey`.
 *
 * An external store in the shape React's `useSyncExternalStore` wants: `subscribe`, and `get(key)` which returns the same
 * object until that copy is set again.
 */

/** A working copy and the saved document it was opened from (`null` when it is saved nowhere yet). */
export interface Draft {
  doc: EditorDoc;
  base: ScenarioDocument | null;
}

export const draftKey = {
  /** A saved scenario being edited. */
  scenario: (name: string) => `scenario:${name}`,
  /** A duplicate of a scenario, not saved yet. */
  copy: (name: string) => `copy:${name}`,
  /** The new scenario: from the New scenario card, or the Lab's timeline handed over. */
  new: 'new',
} as const;

export class EditorDrafts {
  private readonly drafts = new Map<string, Draft>();
  private readonly listeners = new Set<() => void>();

  /** The same object until the copy is set again, as `useSyncExternalStore` needs. */
  get = (key: string): Draft | undefined => this.drafts.get(key);

  set(key: string, draft: Draft): void {
    this.drafts.set(key, draft);
    this.notify();
  }

  /** Forgets a copy; nothing happens (and nobody is told) when there is none. */
  discard(key: string): void {
    if (this.drafts.delete(key)) this.notify();
  }

  /** The keys of the copies that differ from what is saved. */
  dirtyKeys(): string[] {
    return [...this.drafts.entries()]
      .filter(([, draft]) => isDirty(draft.doc, draft.base))
      .map(([key]) => key);
  }

  hasDirty(): boolean {
    return this.dirtyKeys().length > 0;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
