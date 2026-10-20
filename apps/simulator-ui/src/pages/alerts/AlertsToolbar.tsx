import type { AlertsQuery, AlertStatusFilter, SeverityFilter } from '../../lib/alertsQuery';
import { SEVERITY_FILTERS } from '../../lib/alertsQuery';
import { Segmented } from '../../ui/Segmented';
import { SelectField } from '../../ui/SelectField';
import styles from './alerts.module.css';

export interface AlertsToolbarProps {
  query: AlertsQuery;
  onChange: (patch: Partial<AlertsQuery>) => void;
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'all', label: 'All' },
] as const satisfies readonly { value: AlertStatusFilter; label: string }[];

const SEVERITY_LABELS: Record<SeverityFilter, string> = {
  all: 'All severities',
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const isStatus = (value: string): value is AlertStatusFilter => value === 'open' || value === 'all';
const isSeverity = (value: string): value is SeverityFilter =>
  (SEVERITY_FILTERS as readonly string[]).includes(value);

/**
 * The filters of the list: _Open_ or _All_ (ingest filters by status), and a severity (which can only hide rows of
 * the page already loaded, since ingest has no such parameter: the list says so when it hides any). No counts on the
 * status control: the API gives no total, and a count of what happens to be loaded would read as one.
 */
export function AlertsToolbar({ query, onChange }: AlertsToolbarProps) {
  return (
    <div className={styles.toolbar} role="group" aria-label="Alert filters">
      <Segmented
        label="Status"
        value={query.status}
        options={STATUS_OPTIONS}
        onChange={(value) => isStatus(value) && onChange({ status: value })}
      />
      <SelectField
        label="Severity"
        value={query.severity}
        options={SEVERITY_FILTERS.map((value) => ({ value, label: SEVERITY_LABELS[value] }))}
        onChange={(value) => isSeverity(value) && onChange({ severity: value })}
      />
    </div>
  );
}
