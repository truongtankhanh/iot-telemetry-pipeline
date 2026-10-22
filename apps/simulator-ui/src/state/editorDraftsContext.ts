import { createContext, useContext, useSyncExternalStore } from 'react';
import type { Draft, EditorDrafts } from './editorDrafts';

/** The timeline editor's working copies of this window. Provided once by `StudioProvider`; a test provides its own. */
export const EditorDraftsContext = createContext<EditorDrafts | null>(null);

export function useEditorDrafts(): EditorDrafts {
  const drafts = useContext(EditorDraftsContext);
  if (drafts === null) throw new Error('The editor drafts need a StudioProvider above them');
  return drafts;
}

/** The working copy under `key`, as of the last change; `undefined` when there is none (an empty key never has one). */
export function useEditorDraft(key: string): Draft | undefined {
  const drafts = useEditorDrafts();
  return useSyncExternalStore(drafts.subscribe, () => drafts.get(key));
}
