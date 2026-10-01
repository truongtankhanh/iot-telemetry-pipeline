export interface AlertForDelivery {
  id: string;
  deviceId: string;
  deviceName: string;
  zoneCode: string;
  ruleId: string;
  metric: string;
  severity: string;
  title: string;
  incidentType: string;
  openedAt: Date;
  openedValue: number;
  clearedAt: Date | null;
  clearedValue: number | null;
  externalRef: string | null;
}

/** Thrown when delivery should be retried later rather than counted as a failure of the sink. */
export class RetryLater extends Error {}

/**
 * Where alert events go (ADR-0005). `opened` returns the external reference (e.g. incident id)
 * stored on the alert; `cleared` receives it back.
 */
export interface AlertSink {
  readonly name: string;
  opened(alert: AlertForDelivery): Promise<string | null>;
  cleared(alert: AlertForDelivery): Promise<void>;
}

export const ALERT_SINK = Symbol('ALERT_SINK');
