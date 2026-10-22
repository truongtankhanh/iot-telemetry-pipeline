import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Anomaly, ScenarioItem } from '../../api/types';
import {
  addEntry,
  copyOf,
  type EditorDoc,
  type EditResult,
  editEntry,
  type EntryPatch,
  EMPTY_DOC,
  fromScenario,
  isDirty,
  lengthOf,
  moveEntry,
  removeEntry,
  resizeEntry,
  type ScenarioDocument,
  setDescription,
  setName,
  SNAP_OFF_S,
  SNAP_ON_S,
  toDocument,
} from '../../lib/timelineEditor';
import { effectiveWindow } from '../../lib/timelineGeometry';
import { type DocErrors, validateDoc } from '../../lib/timelineValidation';
import { type Draft, draftKey } from '../../state/editorDrafts';
import { useEditorDraft, useEditorDrafts } from '../../state/editorDraftsContext';
import { useStudio } from '../../state/studioContext';
import { useScenarioLibrary } from '../scenarios/useScenarioLibrary';
import { resolveOpening } from './timelineOpening';
import { useTimelineParams } from './useTimelineParams';

/** A line under the canvas: what stopped an edit, or what the last command did. */
export interface EditorMessage {
  tone: 'note' | 'ok' | 'bad';
  text: string;
}

const NO_DEVICES: never[] = [];

/**
 * The timeline editor's state (frame 05): which scenario the address asks for, its working copy, the selection, the snap, the
 * window, and every edit as a function of the copy. The copy lives in `EditorDrafts` (outside React, for the session), not here,
 * so leaving the page and coming back does not lose it (decision Q2); this hook only reads and writes it. Nothing here talks to
 * the simulator beyond reading the library; saving, running and deleting are `useEditorCommands`'.
 *
 * What the address opens: `?scenario=` a saved custom scenario, `?duplicate=` a copy of one, nothing a new scenario. A copy
 * that was never edited is not stored (opening it again makes the same copy), so only a copy the person touched can be lost,
 * and only that one holds the page back from a reload.
 */
export function useScenarioEditor() {
  const view = useStudio((state) => state.view);
  const drafts = useEditorDrafts();
  const [query, setQuery] = useTimelineParams();
  const library = useScenarioLibrary();
  const libraryScenarios = library.library?.scenarios ?? null;

  // The scenario just saved, until the library read that follows the save has brought it: without it the address
  // (`?scenario=<name>`) would name a scenario the page does not know yet and open a new one for a moment.
  const [recent, setRecent] = useState<ScenarioItem | null>(null);
  const scenarios = useMemo(() => {
    if (recent === null) return libraryScenarios;
    if (libraryScenarios === null) return [recent];
    return libraryScenarios.some((item) => item.name === recent.name)
      ? libraryScenarios
      : [...libraryScenarios, recent];
  }, [libraryScenarios, recent]);

  const opening = useMemo(() => resolveOpening(query, scenarios), [query, scenarios]);
  const key = opening.kind === 'loading' ? '' : opening.key;

  // What the copy starts as when nothing has been stored for it: the saved scenario, a duplicate of one, or nothing.
  const initial = useMemo<Draft | null>(() => {
    if (opening.kind === 'saved') {
      const doc = fromScenario(opening.item);
      return { doc, base: toDocument(doc) };
    }
    if (opening.kind === 'copy') return { doc: copyOf(opening.item), base: null };
    if (opening.kind === 'new') return { doc: EMPTY_DOC, base: null };
    return null;
  }, [opening]);

  const stored = useEditorDraft(key);
  const current = stored ?? initial;
  const doc = current?.doc ?? EMPTY_DOC;
  const base: ScenarioDocument | null = current?.base ?? null;

  const [selection, setSelection] = useState<{ key: string; id: string | null }>({
    key: '',
    id: null,
  });
  const selectedId =
    selection.key === key && doc.entries.some((entry) => entry.id === selection.id)
      ? selection.id
      : null;
  const select = useCallback((id: string | null) => setSelection({ key, id }), [key]);

  const [snap, setSnap] = useState(true);
  const step = snap ? SNAP_ON_S : SNAP_OFF_S;

  const [chosen, setChosen] = useState<{ key: string; value: number } | null>(null);
  const windowS = effectiveWindow(chosen?.key === key ? chosen.value : null, lengthOf(doc));
  const setWindow = useCallback((value: number) => setChosen({ key, value }), [key]);

  const [message, setMessage] = useState<EditorMessage | null>(null);
  const note = useCallback((text: string | null) => {
    setMessage(text === null ? null : { tone: 'note', text });
  }, []);

  // Read the copy afresh at every edit: a drag sends several moves before React has drawn the first.
  const read = useCallback(
    (): Draft => drafts.get(key) ?? initial ?? { doc: EMPTY_DOC, base: null },
    [drafts, key, initial],
  );
  const commit = useCallback(
    (next: EditorDoc) => {
      if (key === '') return;
      drafts.set(key, { doc: next, base: read().base });
    },
    [drafts, key, read],
  );

  const move = useCallback(
    (id: string, startAt: number) => {
      const result = moveEntry(read().doc, id, startAt, step);
      commit(result.doc);
      note(result.notice);
    },
    [read, commit, note, step],
  );

  const resize = useCallback(
    (id: string, edge: 'start' | 'end', time: number) => {
      const result = resizeEntry(read().doc, id, edge, time, step);
      commit(result.doc);
      note(result.notice);
    },
    [read, commit, note, step],
  );

  const add = useCallback(
    (anomaly: Anomaly) => {
      const result = addEntry(read().doc, anomaly);
      if (!result.ok) {
        setMessage({ tone: 'bad', text: result.reason });
        return result;
      }
      commit(result.doc);
      setSelection({ key, id: result.id });
      setMessage(null);
      return result;
    },
    [read, commit, key],
  );

  const edit = useCallback(
    (id: string, patch: EntryPatch): EditResult => {
      const result = editEntry(read().doc, id, patch);
      if (result.ok) {
        commit(result.doc);
        setMessage(null);
      }
      return result;
    },
    [read, commit],
  );

  const remove = useCallback(
    (id: string) => {
      commit(removeEntry(read().doc, id));
      setSelection({ key, id: null });
      setMessage(null);
    },
    [read, commit, key],
  );

  const rename = useCallback((name: string) => commit(setName(read().doc, name)), [read, commit]);
  const describe = useCallback(
    (description: string) => commit(setDescription(read().doc, description)),
    [read, commit],
  );

  /** Puts a copy back as it was (the drag that is cancelled). */
  const restore = useCallback((previous: EditorDoc) => commit(previous), [commit]);

  /** Drops the working copy: the scenario is as it is saved again (or a copy / a new scenario as it starts). */
  const discard = useCallback(() => {
    drafts.discard(key);
    setSelection({ key, id: null });
    setMessage(null);
  }, [drafts, key]);

  /**
   * The scenario has been saved (`item` is the card the simulator answered with): the copy now lives under the saved scenario's
   * key, with what was saved as its base, and the address points at it (a new scenario or a duplicate becomes a saved one).
   */
  const afterSave = useCallback(
    (saved: EditorDoc, item: ScenarioItem) => {
      setRecent(item);
      const savedKey = draftKey.scenario(saved.name);
      drafts.set(savedKey, { doc: saved, base: toDocument(saved) });
      if (savedKey !== key) drafts.discard(key);
      setQuery({ scenario: saved.name, duplicate: null });
    },
    [drafts, key, setQuery],
  );

  /** The scenario is gone: its copy goes with it. */
  const afterDelete = useCallback(() => {
    setRecent(null);
    drafts.discard(key);
    setSelection({ key: '', id: null });
    setMessage(null);
    setQuery({ scenario: null, duplicate: null });
  }, [drafts, key, setQuery]);

  // A reload or a closed tab loses the copies; ask first while any of them holds work.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!drafts.hasDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);

  const devices = view?.devices ?? NO_DEVICES;
  const saved: ScenarioItem | null = opening.kind === 'saved' ? opening.item : null;
  const taken = useMemo(
    () => (opening.kind === 'saved' ? null : (scenarios ?? []).map((item) => item.name)),
    [opening.kind, scenarios],
  );
  const errors: DocErrors = useMemo(
    () => validateDoc(doc, { devices, taken }),
    [doc, devices, taken],
  );

  return {
    /** `loading` until the state, and the library when the address needs it, have arrived. */
    status: view === null || opening.kind === 'loading' ? ('loading' as const) : ('ready' as const),
    /** Why the library could not be read, while the address needs it. */
    loadError:
      opening.kind === 'loading' && library.status === 'error' ? (library.error ?? 'Failed') : null,
    retry: library.refresh,
    library,
    kind: opening.kind === 'loading' ? ('new' as const) : opening.kind,
    /** The saved scenario being edited, or `null`. */
    saved,
    /** A sentence for why a new scenario was opened instead of what the address asked for, or `null`. */
    openingNotice: opening.kind === 'new' ? opening.notice : null,
    key,
    doc,
    base,
    dirty: isDirty(doc, base),
    errors,
    devices,
    selectedId,
    select,
    snap,
    setSnap,
    step,
    windowS,
    setWindow,
    message,
    setMessage,
    move,
    resize,
    add,
    edit,
    remove,
    rename,
    describe,
    restore,
    discard,
    afterSave,
    afterDelete,
    /** The address, for the page's own links. */
    query,
  };
}

export type ScenarioEditor = ReturnType<typeof useScenarioEditor>;
