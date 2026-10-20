import {
  type EvaluationStatus,
  type EvaluationTarget,
  type RuleEvaluation as Evaluation,
  ruleEvaluation,
} from '../../lib/topologyDetail';
import { useSeries } from '../../state/historyContext';
import { Card } from '../../ui/Card';
import { Chip } from '../../ui/Chip';
import { toneIcons } from '../../ui/icons';
import styles from './detail.module.css';

export interface RuleEvaluationProps {
  /** What the rule did, or `null` when no rule applies (the reason is `empty`). */
  evaluation: Evaluation | null;
  /** The sentence for no evaluation: "No rule watches this metric.", "Rules are not available: …". */
  empty: string;
  /** The device the evaluation is for, named when the row is not about one device's own card. */
  deviceId?: string;
}

const CHIPS: Record<EvaluationStatus, { tone: 'warn' | 'ok' | 'neutral'; word: string }> = {
  raised: { tone: 'warn', word: 'Raised' },
  cleared: { tone: 'ok', word: 'Cleared' },
  'not-raised': { tone: 'neutral', word: 'Not raised' },
};

/**
 * What the rule did for this device (frame 04, second column): the rule, its condition, the readings that raised it,
 * where it clears, when it was raised and how long it took, as a table. Times after the alert are labelled as observed
 * by the note under it. There is no Cause row (which scenario ran is not known before SIM-08).
 */
export function RuleEvaluation({ evaluation, empty, deviceId }: RuleEvaluationProps) {
  const chip = evaluation === null ? null : CHIPS[evaluation.status];
  return (
    <Card
      title="Rule evaluation"
      aside={
        chip === null ? null : (
          <Chip
            tone={chip.tone}
            icon={
              chip.tone === 'warn' ? toneIcons.warn : chip.tone === 'ok' ? toneIcons.ok : undefined
            }
          >
            {chip.word}
          </Chip>
        )
      }
    >
      {evaluation === null ? (
        <p className={styles.muted}>{empty}</p>
      ) : (
        <>
          {deviceId ? <p className={styles.muted}>For {deviceId}.</p> : null}
          <table className={styles.facts}>
            <tbody>
              {evaluation.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td
                    data-mono={row.mono ? 'true' : undefined}
                    data-warn={row.warn ? 'true' : undefined}
                  >
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {evaluation.note ? <p className={styles.note}>{evaluation.note}</p> : null}
        </>
      )}
    </Card>
  );
}

export interface RuleEvaluationForProps {
  target: EvaluationTarget | null;
  /** The sentence for no target. */
  empty: string;
  /** Name the device in the card (a stage or a zone is selected, so it is not the device's own card). */
  showDevice: boolean;
}

/** The card for a target: it reads the history of the rule's metric and works out the evaluation. */
export function RuleEvaluationFor({ target, empty, showDevice }: RuleEvaluationForProps) {
  // A hook cannot be skipped, so with no target the series is of nothing and the card says why.
  const series = useSeries(target?.deviceId ?? '', target?.rule.metric ?? '');
  const evaluation =
    target === null ? null : ruleEvaluation({ rule: target.rule, alert: target.alert, series });
  return (
    <RuleEvaluation
      evaluation={evaluation}
      empty={empty}
      {...(showDevice && target !== null ? { deviceId: target.deviceId } : {})}
    />
  );
}
