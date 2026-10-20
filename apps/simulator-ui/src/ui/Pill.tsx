import { Icon } from './Icon';
import { type Tone, toneIcons } from './icons';
import { useAnimationSlot } from './animationBudgetContext';
import styles from './status.module.css';

const TONE_WORDS: Record<Tone, string> = {
  ok: 'ok',
  warn: 'warning',
  bad: 'problem',
  unknown: 'unknown',
};

export interface PillProps {
  /** What it is a status of: "Ingest". */
  label: string;
  /** A port, a reason, a count. */
  detail?: string | null;
  tone: Tone;
  /** Old data: drawn dashed and without light. */
  stale?: boolean;
  title?: string;
}

/**
 * A status in the header or beside a dependency. It says it three ways, so colour is never the only one:
 * the icon, the border (dashed when unknown or stale) and words (the label, the detail and, for a screen
 * reader, the tone). Only a pill that asks for attention (a warning, a problem) takes a slot of the
 * animation budget; a healthy one keeps its glow still.
 */
export function Pill({ label, detail, tone, stale = false, title }: PillProps) {
  const animated = useAnimationSlot('node', !stale && (tone === 'warn' || tone === 'bad'));
  return (
    <span
      className={styles.pill}
      data-tone={tone}
      data-stale={stale ? 'true' : undefined}
      title={title}
    >
      <span
        className={styles.pillIcon}
        data-tone={tone}
        data-animated={animated ? 'true' : undefined}
      >
        <Icon glyph={toneIcons[tone]} size="sm" />
      </span>
      <span>{label}</span>
      {detail ? <span className={styles.detail}>{detail}</span> : null}
      <span className="visually-hidden">
        {TONE_WORDS[tone]}
        {stale ? ', last known' : ''}
      </span>
    </span>
  );
}
