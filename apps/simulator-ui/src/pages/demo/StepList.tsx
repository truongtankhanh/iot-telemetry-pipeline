import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import type { StepStanding } from '../../lib/demoSession';
import styles from './demo.module.css';

export interface StepListItem {
  id: string;
  title: string;
  /** The line under the title, with its `{tokens}` filled. */
  summary: string;
  standing: StepStanding;
}

export interface StepListProps {
  items: readonly StepListItem[];
  /** "Script: overheat-to-incident · 6 steps · about 4 min". */
  scriptLine: string;
}

/**
 * The steps of the script (frame 08), in order, with the current one marked `aria-current="step"`. A step that is done has a check
 * and the word "done" for a screen reader, so where the demo is never rests on colour alone. The list keeps its role: a list
 * without markers loses it in some browsers.
 */
export function StepList({ items, scriptLine }: StepListProps) {
  return (
    <nav aria-label="Demo steps" className={styles.steps}>
      <ol className={styles.list} role="list">
        {items.map((item, index) => (
          <li
            key={item.id}
            className={styles.step}
            data-standing={item.standing}
            aria-current={item.standing === 'current' ? 'step' : undefined}
          >
            <span className={styles.stepNumber} aria-hidden="true">
              {item.standing === 'done' ? <Icon glyph={uiIcons.check} size="sm" /> : index + 1}
            </span>
            <span>
              <b className={styles.stepTitle}>{item.title}</b>
              <span className={styles.stepSummary}>{item.summary}</span>
              {item.standing === 'done' ? <span className="visually-hidden">Done</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <p className={styles.scriptLine}>{scriptLine}</p>
    </nav>
  );
}
