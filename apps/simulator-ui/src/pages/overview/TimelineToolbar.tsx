import { useId } from 'react';
import { DEFAULT_EVENT_QUERY, type EventQuery } from '../../lib/eventQuery';
import {
  EVENT_SOURCES,
  FILTER_KEYS,
  type ParsedFilter,
  RANGE_IDS,
  RANGE_LABELS,
  type RangeId,
  type TimeWindow,
} from '../../lib/eventRows';
import { fromInputValue, toInputValue } from '../../lib/eventTime';
import type { TimeZoneChoice } from '../../lib/preferences';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import { Segmented } from '../../ui/Segmented';
import { SelectField } from '../../ui/SelectField';
import styles from './overview.module.css';

const SOURCE_OPTIONS = [
  { value: 'all', label: 'All sources' },
  ...EVENT_SOURCES.map((source) => ({ value: source, label: source })),
];

export interface TimelineToolbarProps {
  query: EventQuery;
  /** The window the range covers now (a custom range is read from the fields, a relative one from the clock). */
  window: TimeWindow;
  zone: TimeZoneChoice;
  filter: ParsedFilter;
  /** Rows to export; the button is off with none. */
  exportable: number;
  onQuery: (patch: Partial<EventQuery>) => void;
  onZone: (zone: TimeZoneChoice) => void;
  onExport: () => void;
}

/**
 * The controls of the event timeline (frame 11): the filter field, the source, the range (five relative ones and Custom,
 * which shows its two bounds), Local or UTC, and Export. A change of the range, the filter or the source starts again at
 * the first page. The bounds of a custom range are fields of date and time in the zone the table shows.
 */
export function TimelineToolbar({
  query,
  window,
  zone,
  filter,
  exportable,
  onQuery,
  onZone,
  onExport,
}: TimelineToolbarProps) {
  const hintId = useId();
  const custom = query.range === 'custom' && query.from !== null && query.to !== null;
  const first = { page: DEFAULT_EVENT_QUERY.page };

  const setRange = (range: RangeId) => {
    if (range === 'custom') {
      // Start from what is on show, so the two fields hold the range the person was looking at.
      onQuery({ ...first, range, from: Math.round(window.from), to: Math.round(window.to) });
    } else {
      onQuery({ ...first, range, from: null, to: null });
    }
  };

  const setBound = (which: 'from' | 'to', value: string) => {
    const ms = fromInputValue(value, zone);
    if (ms === null) return;
    const from = which === 'from' ? ms : (query.from ?? window.from);
    const to = which === 'to' ? ms : (query.to ?? window.to);
    // Two bounds that are not in order are not a range: the field keeps its value until the other one is fixed.
    if (from < to) onQuery({ ...first, range: 'custom', from, to });
  };

  return (
    <div className={styles.timelineBar}>
      <div className={styles.filterRow}>
        <label className={styles.filterField}>
          <Icon glyph={uiIcons.filter} size="sm" />
          <input
            type="text"
            aria-label="Filter events"
            aria-describedby={hintId}
            placeholder="Filter events, for example source:Alert device:dc-env-01"
            value={query.q}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onQuery({ ...first, q: event.target.value })}
          />
        </label>
        <SelectField
          label="Source"
          value={query.source}
          options={SOURCE_OPTIONS}
          onChange={(value) =>
            onQuery({ ...first, source: value === 'all' ? 'all' : (value as EventQuery['source']) })
          }
        />
        <Segmented
          label="Range"
          value={query.range}
          onChange={(value) => setRange(value as RangeId)}
          options={RANGE_IDS.map((id) => ({ value: id, label: RANGE_LABELS[id] }))}
        />
        <Segmented
          label="Time display"
          value={zone}
          onChange={(value) => onZone(value === 'utc' ? 'utc' : 'local')}
          options={[
            { value: 'local', label: 'Local' },
            { value: 'utc', label: 'UTC' },
          ]}
        />
        <Button
          variant="ghost"
          size="sm"
          icon={uiIcons.download}
          disabled={exportable === 0}
          onClick={onExport}
          title="Downloads every event that passes the filter, as CSV with times in UTC"
        >
          Export
        </Button>
      </div>

      {custom ? (
        <div className={styles.customRow} role="group" aria-label="Custom range">
          <label>
            <span>From</span>
            <input
              type="datetime-local"
              value={toInputValue(query.from as number, zone)}
              onChange={(event) => setBound('from', event.target.value)}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="datetime-local"
              value={toInputValue(query.to as number, zone)}
              onChange={(event) => setBound('to', event.target.value)}
            />
          </label>
          <span className={styles.hint}>
            In {zone === 'utc' ? 'UTC' : 'your time zone'}. The range must end after it starts.
          </span>
        </div>
      ) : null}

      <p id={hintId} className={styles.hint} role="status">
        {filter.unknownKeys.length > 0
          ? `${filter.unknownKeys.map((key) => `${key}:`).join(', ')} ${filter.unknownKeys.length === 1 ? 'is' : 'are'} not a filter key, so ${filter.unknownKeys.length === 1 ? 'it is' : 'they are'} searched as text. `
          : ''}
        Keys: {FILTER_KEYS.join(', ')}. Every term must match.
      </p>
    </div>
  );
}
