import type { ObservedAlert } from '../api/types';
import { Chip } from './Chip';
import { toneIcons } from './icons';

export interface DeliveryChipProps {
  alert: Pick<ObservedAlert, 'deliveryStatus' | 'deliveryAttempts' | 'deliveryError'>;
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/**
 * The state of an alert's latest outbox event as a chip with a word and, where it matters, an icon: delivered,
 * pending, failed (with ingest's error) or skipped. A status ingest adds later, or none, is "Delivery unknown",
 * never "delivered": a chip must not say a thing reached the command center that nothing says did.
 */
export function DeliveryChip({ alert }: DeliveryChipProps) {
  const attempts =
    alert.deliveryAttempts === null ? '' : ` · ${plural(alert.deliveryAttempts, 'attempt')}`;
  switch (alert.deliveryStatus) {
    case 'delivered':
      return (
        <Chip tone="ok" icon={toneIcons.ok}>
          Delivered{attempts}
        </Chip>
      );
    case 'pending':
      return <Chip tone="warn">Pending{attempts}</Chip>;
    case 'failed':
      return (
        <Chip tone="bad" icon={toneIcons.bad}>
          Failed{attempts}
          {alert.deliveryError ? ` · ${alert.deliveryError}` : ''}
        </Chip>
      );
    case 'skipped':
      return <Chip>Skipped</Chip>;
    default:
      return <Chip>Delivery unknown</Chip>;
  }
}
