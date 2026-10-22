import { useMemo, useState } from 'react';
import type { RulesView, StateView } from '../../api/types';
import { formatClockTime } from '../../lib/time';
import { anomaliesOf } from '../../lib/timelineEditor';
import { LabSwitcher } from '../../shell/LabSwitcher';
import { useStudio } from '../../state/studioContext';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { toneIcons } from '../../ui/icons';
import { useExpectedImpact } from '../lab/useExpectedImpact';
import { EditorCanvas } from './EditorCanvas';
import { DeleteDialog } from '../scenarios/DeleteDialog';
import { ReplaceDialog } from '../scenarios/ReplaceDialog';
import { AnomalyInspector } from './AnomalyInspector';
import { EditorHeader } from './EditorHeader';
import { ExpectedAlertsTable } from './ExpectedAlertsTable';
import styles from './timeline.module.css';
import { useEditorCommands } from './useEditorCommands';
import { useScenarioEditor } from './useScenarioEditor';

const RULES_UNKNOWN: RulesView = {
  available: false,
  reason: 'The rules have not arrived',
  items: [],
};
const NO_PROFILES: StateView['profiles'] = {};

/**
 * The timeline editor (frame 05), the Lab's page for building a scenario by hand: lanes per device, the anomalies as blocks
 * that can be moved and resized, an inspector for the one that is selected, the alerts the rules should raise for all of
 * it, and Save, Run now and Export for the scenario as a whole. What it edits comes from the address (`?scenario=` a saved
 * scenario, `?duplicate=` a copy of one, nothing a new one); the working copy lives outside this page, so leaving it and
 * coming back does not lose it.
 *
 * This component holds the page's hooks and hands each part what it draws: the state and edits (`useScenarioEditor`) and
 * the commands (`useEditorCommands`). The parts are components of their own.
 */
export function Timeline() {
  const link = useStudio((state) => state.link);
  const lostSince = useStudio((state) => state.lostSince);
  const rules = useStudio((state) => state.view?.rules) ?? RULES_UNKNOWN;
  const profiles = useStudio((state) => state.view?.profiles) ?? NO_PROFILES;
  const editor = useScenarioEditor();
  const commands = useEditorCommands(editor);
  const [deleting, setDeleting] = useState(false);
  // What the rules should do with the scenario as it is now, asked a moment after it stops changing.
  const anomalies = useMemo(() => anomaliesOf(editor.doc), [editor.doc]);
  const impact = useExpectedImpact(anomalies);

  const status =
    link === 'lost' ? (
      <Chip tone="bad">
        {lostSince === null ? 'Lost' : `Lost at ${formatClockTime(lostSince)}`}
      </Chip>
    ) : link === 'live' ? (
      <Chip tone="ok">Connected</Chip>
    ) : (
      <Chip>Connecting</Chip>
    );

  if (editor.status === 'loading') {
    return (
      <div className={styles.page}>
        <LabSwitcher />
        <Card title="Timeline">
          {editor.loadError === null ? (
            <p className={styles.waiting} role="status">
              {link === 'lost'
                ? 'The simulator has not answered yet.'
                : 'Waiting for the first message from the simulator…'}
            </p>
          ) : (
            <div className={styles.error} role="alert">
              <span className={styles.noticeText}>
                <b>The scenarios could not be read.</b> {editor.loadError}
              </span>
              <Button size="sm" variant="outline" onClick={editor.retry}>
                Try again
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const notice = commands.notice;
  const message = editor.message;

  return (
    <div className={styles.page} data-stale={link === 'lost' ? 'true' : undefined}>
      <LabSwitcher />
      <EditorHeader
        editor={editor}
        commands={commands}
        status={status}
        onDelete={() => setDeleting(true)}
      />

      {editor.openingNotice === null ? null : (
        <div className={styles.notice} data-tone="note" role="status">
          <Icon glyph={toneIcons.warn} size="sm" />
          <span className={styles.noticeText}>{editor.openingNotice}</span>
        </div>
      )}

      {commands.error === null ? null : (
        <div className={styles.error} role="alert">
          <Icon glyph={toneIcons.bad} size="sm" />
          <span className={styles.noticeText}>{commands.error}</span>
          <Button size="sm" variant="ghost" onClick={commands.dismissError}>
            Dismiss
          </Button>
        </div>
      )}

      {notice === null ? null : (
        <div
          className={styles.notice}
          data-tone={notice.tone}
          role={notice.tone === 'bad' ? 'alert' : 'status'}
        >
          <Icon glyph={notice.tone === 'bad' ? toneIcons.bad : toneIcons.ok} size="sm" />
          <span className={styles.noticeText}>{notice.text}</span>
          <Button size="sm" variant="ghost" onClick={commands.dismissNotice}>
            Dismiss
          </Button>
        </div>
      )}

      {message === null ? null : (
        <div className={styles.notice} data-tone={message.tone} role="status">
          <Icon glyph={message.tone === 'bad' ? toneIcons.bad : toneIcons.ok} size="sm" />
          <span className={styles.noticeText}>{message.text}</span>
        </div>
      )}

      <div className={styles.workspace}>
        <div className={styles.main}>
          <EditorCanvas editor={editor} commands={commands} impact={impact} />
        </div>
        <aside className={styles.side} aria-label="Inspector and expected alerts">
          <AnomalyInspector
            editor={editor}
            impact={impact}
            rules={rules}
            profiles={profiles}
            devices={editor.devices}
          />
          <ExpectedAlertsTable doc={editor.doc} impact={impact} />
        </aside>
      </div>
      {commands.pending === null ? null : (
        <ReplaceDialog
          pending={commands.pending}
          busy={commands.runBusy}
          onConfirm={() => void commands.confirmReplace()}
          onCancel={commands.cancelReplace}
        />
      )}
      {!deleting ? null : (
        <DeleteDialog
          name={editor.doc.name}
          busy={commands.busy === 'delete'}
          onConfirm={() => {
            void commands.remove().then(() => setDeleting(false));
          }}
          onCancel={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
