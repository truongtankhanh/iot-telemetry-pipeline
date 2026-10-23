import { METRIC_NAMES, type MetricName } from '@itp/telemetry-contract';
import type { ReactNode } from 'react';
import type { MessageQuery } from '../../lib/messageQuery';
import { Icon } from '../../ui/Icon';
import { uiIcons } from '../../ui/icons';
import { Segmented } from '../../ui/Segmented';
import { SelectField } from '../../ui/SelectField';
import styles from './events.module.css';

export interface EventsToolbarProps {
  query: MessageQuery;
  /** The ids of the registry's devices. A device the address names that is not among them is still offered, so the field shows it. */
  devices: readonly string[];
  onChange: (patch: Partial<MessageQuery>) => void;
  /** "Last 200 of 7,612 · 2.0 msg/s". */
  summary: ReactNode;
}

const isMetric = (value: string): value is MetricName =>
  (METRIC_NAMES as readonly string[]).includes(value);

/**
 * The filters of the Event stream, above the tail: text in the topic or the payload, a device, a metric. A group, not an ARIA
 * toolbar (a search field needs the arrow keys for itself). The line at the end says how much is shown of how much was published
 * and at what rate, so a person reading a filtered list sees what it is a part of.
 */
export function EventsToolbar({ query, devices, onChange, summary }: EventsToolbarProps) {
  const missing = query.device !== null && !devices.includes(query.device) ? query.device : null;
  const options = [
    { value: '', label: 'All devices' },
    ...(missing === null ? [] : [{ value: missing, label: missing }]),
    ...devices.map((id) => ({ value: id, label: id })),
  ];
  return (
    <div className={styles.toolbar} role="group" aria-label="Filter the messages">
      <label className={styles.search}>
        <Icon glyph={uiIcons.search} size="sm" />
        <input
          type="search"
          aria-label="Filter by topic or payload"
          placeholder="Filter by topic or payload"
          value={query.q}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange({ q: event.target.value })}
        />
      </label>
      <SelectField
        label="Device"
        value={query.device ?? ''}
        options={options}
        onChange={(value) => onChange({ device: value === '' ? null : value })}
      />
      <Segmented
        label="Metric"
        value={query.metric ?? 'all'}
        options={[
          { value: 'all', label: 'All' },
          ...METRIC_NAMES.map((name) => ({ value: name, label: name })),
        ]}
        onChange={(value) => onChange({ metric: isMetric(value) ? value : null })}
      />
      <span className={styles.summary}>{summary}</span>
    </div>
  );
}
