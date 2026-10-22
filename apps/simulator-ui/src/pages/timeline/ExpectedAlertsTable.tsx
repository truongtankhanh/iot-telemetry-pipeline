import { useMemo } from 'react';
import { alertsView, type AlertRow } from '../../lib/editorAlerts';
import { lengthOf, type EditorDoc } from '../../lib/timelineEditor';
import { Card } from '../../ui/Card';
import { type Column, DataTable } from '../../ui/DataTable';
import { SeverityBadge } from '../../ui/SeverityBadge';
import type { ExpectedImpact } from '../lab/useExpectedImpact';
import styles from './inspector.module.css';

const columns: Column<AlertRow>[] = [
  { id: 'rule', header: 'Rule', cell: (row) => <span className={styles.mono}>{row.ruleId}</span> },
  {
    id: 'device',
    header: 'Device',
    cell: (row) => <span className={styles.mono}>{row.deviceId}</span>,
  },
  { id: 'severity', header: 'Severity', cell: (row) => <SeverityBadge severity={row.severity} /> },
  { id: 'raised', header: 'Raised about', cell: (row) => row.raised },
  { id: 'clears', header: 'Clears about', cell: (row) => row.clears },
];

export interface ExpectedAlertsTableProps {
  doc: EditorDoc;
  impact: ExpectedImpact;
}

/**
 * The alerts the rules should raise for the whole scenario (frame 05): rule, device, severity, when it raises and when it
 * clears, with the simulator's own numbers worded as the scenario cards word them, and what they rest on. A best case, "about":
 * a device that is already running can be up to one publish interval later. Before the simulator has answered, or when it could
 * not work them out, the card says so instead of showing a made-up row.
 */
export function ExpectedAlertsTable({ doc, impact }: ExpectedAlertsTableProps) {
  const lengthS = lengthOf(doc);
  const expected = impact.preview?.expected ?? null;
  const view = useMemo(() => alertsView(expected, lengthS), [expected, lengthS]);
  const waiting = expected === null && doc.entries.length > 0;
  return (
    <Card title="Expected alerts">
      <div
        className={styles.alerts}
        data-stale={impact.fresh || expected === null ? undefined : 'true'}
      >
        {doc.entries.length === 0 ? (
          <p className={styles.muted}>Add an anomaly to see which alerts the rules should raise.</p>
        ) : waiting ? (
          <p className={styles.muted} role="status">
            Working out the alerts…
          </p>
        ) : view.empty !== null ? (
          <p className={styles.muted} role="status">
            {view.empty}
          </p>
        ) : (
          <DataTable
            caption="Alerts the rules should raise for this scenario"
            columns={columns}
            rows={view.rows}
            rowKey={(row) => row.key}
          />
        )}
        {view.basis === null ? null : <p className={styles.basis}>{view.basis}</p>}
        {view.notes.length === 0 ? null : (
          <ul className={styles.notes}>
            {view.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
