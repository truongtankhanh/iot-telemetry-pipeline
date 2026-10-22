import { useCallback, useState } from 'react';
import { deleteScenario, saveScenario } from '../../api/client';
import type { ScenarioItem } from '../../api/types';
import type { DownloadHost } from '../../lib/eventExport';
import { toDocument } from '../../lib/timelineEditor';
import { downloadScenario } from '../../lib/timelineExport';
import { isValid, problemSummary } from '../../lib/timelineValidation';
import { useStudio, useStudioStore } from '../../state/studioContext';
import { useScenarioCommands } from '../scenarios/useScenarioCommands';
import type { ScenarioEditor } from './useScenarioEditor';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const ignoreImport = () => undefined;

export interface EditorCommandsOptions {
  /** What a download needs of the browser; a test passes its own. */
  download?: DownloadHost;
}

/**
 * The commands the editor gives (frame 05): Save, Discard, Run now (decision Q4: save first when the scenario is new or
 * changed, then run), Stop, Delete and Export. Running, stopping and the question about a run that would play over another
 * are the Scenarios page's own (`useScenarioCommands`), so they behave the same here. A refusal is shown as the simulator
 * words it, next to the button, and the working copy is left as it was; the answer to a command is the new state and goes into
 * the store at once.
 *
 * What a command may not do is said by `saveBlock`/`runBlock`/`deleteBlock` (a sentence, or `null`), so a button can be
 * disabled and say why. A scenario that is running cannot be saved over or deleted (the simulator refuses), and the page
 * offers Stop instead.
 */
export function useEditorCommands(editor: ScenarioEditor, options: EditorCommandsOptions = {}) {
  const store = useStudioStore();
  const { doc, errors, library } = editor;
  const scenario = useScenarioCommands({ onChanged: library.refresh, onImported: ignoreImport });
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = useStudio(
    (state) => state.view?.runs.some((run) => run.scenario === doc.name) ?? false,
  );

  const valid = isValid(errors);
  let saveBlock: string | null = null;
  if (running) saveBlock = 'It is running; stop it first';
  else if (!valid) saveBlock = problemSummary(errors);
  else if (!editor.dirty && editor.kind === 'saved') saveBlock = 'Nothing to save';

  const runBlock = valid ? null : problemSummary(errors);

  let deleteBlock: string | null = null;
  if (editor.kind !== 'saved') deleteBlock = 'It is not saved';
  else if (running) deleteBlock = 'It is running; stop it first';

  /** Saves the copy. Answers the card the simulator sent, or `null` when nothing was saved. */
  const save = useCallback(async (): Promise<ScenarioItem | null> => {
    if (busy !== null || running || !valid) return null;
    setBusy('save');
    setError(null);
    try {
      const { scenario: item, ...view } = await saveScenario(toDocument(doc));
      store.getState().setView(view, Date.now());
      scenario.dismissNotice();
      editor.afterSave(doc, item);
      editor.setMessage({ tone: 'ok', text: `Saved ${doc.name}.` });
      library.refresh();
      return item;
    } catch (failure) {
      setError(message(failure));
      return null;
    } finally {
      setBusy(null);
    }
  }, [busy, running, valid, doc, store, scenario, editor, library]);

  /** Drops the working copy: the scenario is as it was saved (or as it began). */
  const discard = useCallback(() => {
    setError(null);
    editor.discard();
  }, [editor]);

  /** Deletes the saved scenario and its file. */
  const remove = useCallback(async (): Promise<boolean> => {
    if (busy !== null || editor.kind !== 'saved' || running) return false;
    setBusy('delete');
    setError(null);
    try {
      store.getState().setView(await deleteScenario(doc.name), Date.now());
      const name = doc.name;
      editor.afterDelete();
      editor.setMessage({ tone: 'ok', text: `Deleted ${name}.` });
      library.refresh();
      return true;
    } catch (failure) {
      setError(message(failure));
      return false;
    } finally {
      setBusy(null);
    }
  }, [busy, editor, running, doc.name, store, library]);

  /** Run now: saves first when the scenario is new or changed, then runs it. */
  const runNow = useCallback(async (): Promise<void> => {
    if (busy !== null || !valid || running) return;
    const name = doc.name;
    if (editor.dirty || editor.kind !== 'saved') {
      if ((await save()) === null) return;
    }
    await scenario.run(name);
  }, [busy, valid, running, doc.name, editor.dirty, editor.kind, save, scenario]);

  const stop = useCallback(() => scenario.stop(doc.name), [scenario, doc.name]);

  /** Hands the copy to the person as a JSON file. */
  const exportJson = useCallback(() => {
    downloadScenario(toDocument(doc), options.download);
  }, [doc, options.download]);

  return {
    /** The scenario of the copy is playing now. */
    running,
    busy,
    /** What the simulator said when a save or a delete was refused, or `null`. */
    error,
    dismissError: () => setError(null),
    saveBlock,
    runBlock,
    deleteBlock,
    save,
    discard,
    remove,
    runNow,
    stop,
    exportJson,
    /** Whether a run or a stop of the scenario is on its way. */
    runBusy: scenario.isBusy(doc.name),
    /** What the last run or stop did, or `null`. */
    notice: scenario.notice,
    dismissNotice: scenario.dismissNotice,
    /** A run that the simulator refused because something is in the way: asked about before it is repeated. */
    pending: scenario.pending,
    confirmReplace: scenario.confirmReplace,
    cancelReplace: scenario.cancelReplace,
    /** What the simulator said about the scenario's last refused run. */
    runError: scenario.errorOf(doc.name),
  };
}

export type EditorCommands = ReturnType<typeof useEditorCommands>;
