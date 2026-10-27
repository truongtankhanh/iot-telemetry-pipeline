import { type ReactNode, useId } from 'react';
import { MAX_DESCRIPTION_LENGTH } from '../../lib/timelineValidation';
import { Button } from '../../ui/Button';
import { Chip } from '../../ui/Chip';
import { useBenchmarkLock } from '../../state/useBenchmarkLock';
import { uiIcons } from '../../ui/icons';
import styles from './editorHeader.module.css';
import type { EditorCommands } from './useEditorCommands';
import type { ScenarioEditor } from './useScenarioEditor';

export interface EditorHeaderProps {
  editor: ScenarioEditor;
  commands: EditorCommands;
  /** Asks to delete the saved scenario (the page confirms first); without it there is no Delete. */
  onDelete?: () => void;
  /** The link to the simulator, as a chip. */
  status: ReactNode;
}

/**
 * The head of the editor (frame 05): "Simulation lab › Custom", the scenario's name and an "Unsaved changes" chip, and its
 * actions: Discard, Save, Run now (Stop while it runs), Export JSON and, for a saved scenario, Delete. A saved scenario's
 * name is shown, not edited (there is no rename: duplicate it, or save it under a new name); a new scenario or a copy has a
 * field for it. A button that cannot be used is disabled and the reason is in the line under the buttons, which the button
 * points at, so it is not only a greyed-out shape.
 */
export function EditorHeader({ editor, commands, onDelete, status }: EditorHeaderProps) {
  const nameId = useId();
  const nameErrorId = useId();
  const descriptionId = useId();
  const whyId = useId();
  const { doc, errors, kind, dirty } = editor;
  const naming = kind !== 'saved';
  const busy = commands.busy !== null || commands.runBusy;
  // A benchmark is running: the simulator refuses a scenario run (Stop and Save stay open); the banner says why.
  const lock = useBenchmarkLock();

  // Nothing to save is not a problem to explain; the others are.
  const saveWhy = commands.saveBlock === 'Nothing to save' ? null : commands.saveBlock;
  const why =
    dirty || kind !== 'saved' ? (saveWhy !== null ? `Save is off: ${saveWhy}.` : null) : null;
  const nameError = doc.name === '' ? null : (errors.name ?? null);

  return (
    <div className={styles.header}>
      <div className={styles.titles}>
        <p className={styles.crumb}>
          Simulation lab <span aria-hidden="true">›</span> Custom
        </p>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{doc.name === '' ? 'New scenario' : doc.name}</h1>
          {status}
          {dirty ? <Chip tone="warn">Unsaved changes</Chip> : null}
        </div>

        {naming ? (
          <div className={styles.field}>
            <label htmlFor={nameId} className={styles.label}>
              Name
            </label>
            <input
              id={nameId}
              className={styles.input}
              value={doc.name}
              spellCheck={false}
              autoComplete="off"
              maxLength={80}
              aria-invalid={nameError !== null || undefined}
              aria-describedby={nameError !== null ? nameErrorId : undefined}
              placeholder="bad-afternoon"
              onChange={(event) => editor.rename(event.target.value)}
            />
            {nameError === null ? (
              <span className={styles.help}>
                Lower-case letters, digits and hyphens; it is also the file name.
              </span>
            ) : (
              <span id={nameErrorId} className={styles.error} role="alert">
                {nameError}
              </span>
            )}
          </div>
        ) : null}

        <div className={styles.field}>
          <label htmlFor={descriptionId} className={styles.label}>
            Description
          </label>
          <input
            id={descriptionId}
            className={styles.input}
            value={doc.description}
            autoComplete="off"
            aria-invalid={errors.description !== undefined || undefined}
            placeholder="What goes wrong, in a sentence"
            onChange={(event) => editor.describe(event.target.value)}
          />
          <span className={styles.help} data-over={errors.description !== undefined || undefined}>
            {errors.description ?? `${doc.description.length} / ${MAX_DESCRIPTION_LENGTH}`}
          </span>
        </div>
      </div>

      <div className={styles.actions}>
        <div className={styles.buttons}>
          <Button variant="ghost" disabled={!dirty || busy} onClick={commands.discard}>
            Discard
          </Button>
          <Button
            variant="outline"
            disabled={commands.saveBlock !== null || busy}
            aria-busy={commands.busy === 'save' || undefined}
            aria-describedby={why === null ? undefined : whyId}
            onClick={() => void commands.save()}
          >
            Save
          </Button>
          {commands.running ? (
            <Button
              variant="danger"
              icon={uiIcons.stop}
              disabled={commands.runBusy}
              onClick={() => void commands.stop()}
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={uiIcons.play}
              disabled={commands.runBlock !== null || busy || lock.locked}
              aria-busy={commands.runBusy || undefined}
              onClick={() => void commands.runNow()}
            >
              Run now
            </Button>
          )}
        </div>
        <div className={styles.buttons}>
          <Button variant="ghost" size="sm" icon={uiIcons.download} onClick={commands.exportJson}>
            Export JSON
          </Button>
          {onDelete === undefined || kind !== 'saved' ? null : (
            <Button
              variant="ghost"
              size="sm"
              disabled={commands.deleteBlock !== null || busy}
              onClick={onDelete}
            >
              Delete
            </Button>
          )}
        </div>
        {why === null ? null : (
          <p id={whyId} className={styles.why}>
            {why}
          </p>
        )}
      </div>
    </div>
  );
}
