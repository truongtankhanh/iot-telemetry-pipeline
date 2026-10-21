import type { EventRow as Row } from '../../lib/eventRows';
import { formatEventClock } from '../../lib/eventTime';
import type { TimeZoneChoice } from '../../lib/preferences';
import { Chip } from '../../ui/Chip';
import { Icon } from '../../ui/Icon';
import { eventGlyphs, uiIcons } from '../../ui/icons';
import styles from './overview.module.css';

export interface EventRowProps {
  row: Row;
  expanded: boolean;
  onToggle: () => void;
  zone: TimeZoneChoice;
  /** Studio saw it a moment ago: the row has a wash for a few seconds (no animation, so nothing to reduce). */
  fresh: boolean;
  /** The id of the row of the details, for the button that opens them. */
  detailsId: string;
}

/**
 * One event of the timeline (two rows of the table): its time, where it came from (a chip with a glyph and the word),
 * what happened, and a button that opens the details under it. The button is a real `<button>` with `aria-expanded`;
 * the row is not clickable in itself, so a person selecting the text of a message does not open it by accident.
 */
export function EventRow({ row, expanded, onToggle, zone, fresh, detailsId }: EventRowProps) {
  return (
    <>
      <tr
        className={styles.event}
        data-fresh={fresh ? 'true' : undefined}
        data-open={expanded || undefined}
      >
        <td className={styles.eventToggle}>
          <button
            type="button"
            className={styles.iconButton}
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} event ${row.id}`}
            onClick={onToggle}
          >
            <Icon glyph={uiIcons.next} size="sm" className={styles.chevron} />
          </button>
        </td>
        <td className={styles.eventTime}>
          <time dateTime={new Date(row.at).toISOString()}>{formatEventClock(row.at, zone)}</time>
        </td>
        <td>
          <Chip icon={eventGlyphs[row.glyph]}>{row.source}</Chip>
        </td>
        <td className={styles.eventMessage}>
          {row.parts.map((part, index) =>
            part.strong ? (
              <b key={index} className={styles.mono}>
                {part.text}
              </b>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </td>
      </tr>
      {expanded ? (
        <tr id={detailsId} className={styles.eventDetails}>
          <td />
          <td colSpan={3}>
            <dl className={styles.eventFields}>
              {row.fields.map((field) => (
                <div key={field.label}>
                  <dt>{field.label}</dt>
                  <dd className={field.mono ? styles.mono : undefined}>{field.value}</dd>
                </div>
              ))}
            </dl>
          </td>
        </tr>
      ) : null}
    </>
  );
}
