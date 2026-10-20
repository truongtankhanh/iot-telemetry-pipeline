import type { ZoneSummary } from '../../lib/topologyDetail';
import { TOPOLOGY_TONES, TOPOLOGY_WORDS } from '../../lib/topologyState';
import { Card } from '../../ui/Card';
import { Pill } from '../../ui/Pill';
import styles from './detail.module.css';

export interface ZoneDetailProps {
  summary: ZoneSummary;
  /** Chooses a device of the zone: it becomes the selection. */
  onSelect: (deviceId: string) => void;
}

/**
 * A zone in the first column: its devices as a short list, problems first, where choosing one selects it. A zone is
 * never a place to act: it is how a device is reached when the graph shows zones only (above 12 devices).
 */
export function ZoneDetail({ summary, onSelect }: ZoneDetailProps) {
  const count = `${summary.count} ${summary.count === 1 ? 'device' : 'devices'}`;
  return (
    <Card
      title={summary.zone}
      aside={
        <Pill
          label={TOPOLOGY_WORDS[summary.worst]}
          detail={count}
          tone={TOPOLOGY_TONES[summary.worst]}
        />
      }
    >
      <ul className={styles.members} aria-label={`Devices in ${summary.zone}`}>
        {summary.members.map((member) => (
          <li key={member.id}>
            <button type="button" className={styles.member} onClick={() => onSelect(member.id)}>
              <span className={styles.mono}>{member.id}</span>
              <span>{member.word}</span>
              <span className={styles.memberValue}>{member.reading ?? '—'}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
