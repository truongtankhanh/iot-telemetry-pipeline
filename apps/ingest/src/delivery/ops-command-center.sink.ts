import { type AlertForDelivery, type AlertSink, RetryLater } from './alert-sink';
import type { TokenSource } from './client-credentials';

const TIMEOUT_MS = 5000;

interface Zone {
  id: string;
  code: string;
}

/**
 * Creates and resolves incidents in ops-command-center
 * (https://github.com/truongtankhanh/ops-command-center) — `POST /api/incidents` when an alert
 * opens, `POST /api/incidents/:id/resolve` when it clears.
 *
 * - With a token source, every request carries a bearer token (ADR-0006); a 401 renews the token
 *   and repeats the request once.
 * - Incident creation carries an `Idempotency-Key` derived from the alert, so a retry after a
 *   lost response returns the incident already created instead of a second one.
 */
export class OpsCommandCenterSink implements AlertSink {
  readonly name = 'ops-command-center';
  private zones?: Map<string, string>;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly tokens?: TokenSource,
  ) {}

  async opened(alert: AlertForDelivery): Promise<string> {
    const zoneId = await this.zoneId(alert.zoneCode);
    const incident = await this.post<{ id: string }>(
      '/incidents',
      {
        type: alert.incidentType,
        severity: alert.severity,
        title: alert.title,
        description:
          `${alert.deviceName} (${alert.deviceId}) reported ${alert.metric} = ${alert.openedValue} ` +
          `at ${alert.openedAt.toISOString()}. Raised by telemetry alert #${alert.id} (${alert.ruleId}).`,
        zoneId,
      },
      { 'Idempotency-Key': idempotencyKey(alert) },
    );
    return incident.id;
  }

  async cleared(alert: AlertForDelivery): Promise<void> {
    if (!alert.externalRef) throw new RetryLater('incident not created yet');
    try {
      await this.post(`/incidents/${alert.externalRef}/resolve`, {
        note: `Cleared automatically: ${alert.metric} back to ${alert.clearedValue} at ${alert.clearedAt?.toISOString()}.`,
      });
    } catch (error) {
      // 409: an operator already resolved it — the outcome we wanted.
      if (error instanceof HttpError && error.status === 409) return;
      throw error;
    }
  }

  private async zoneId(code: string): Promise<string> {
    if (!this.zones?.has(code)) {
      const zones = await this.request<Zone[]>('GET', '/zones');
      this.zones = new Map(zones.map((z) => [z.code, z.id]));
    }
    const id = this.zones.get(code);
    if (!id) throw new Error(`zone ${code} does not exist in ops-command-center`);
    return id;
  }

  private post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
    return this.request<T>('POST', path, body, headers);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const send = async () =>
      this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
          ...(this.tokens ? { Authorization: `Bearer ${await this.tokens.token()}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    let response = await send();
    if (response.status === 401 && this.tokens) {
      // Expired or revoked between our check and the server's: renew once. A second 401 means
      // the credentials themselves are wrong, and retrying would only hide that.
      this.tokens.invalidate();
      response = await send();
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new HttpError(
        response.status,
        `${method} ${path} → ${response.status} ${text.slice(0, 200)}`,
      );
    }
    return (await response.json()) as T;
  }
}

/**
 * One key per alert: the command center scopes keys to the caller, keeps them 24 h — longer than
 * the outbox's whole retry schedule — and answers a repeat with the first incident.
 */
export const idempotencyKey = (alert: Pick<AlertForDelivery, 'id'>): string =>
  `telemetry-alert-${alert.id}`;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Used when no command center is configured: outbox rows are marked skipped. */
export class NoopSink implements AlertSink {
  readonly name = 'none';
  async opened(): Promise<null> {
    return null;
  }
  async cleared(): Promise<void> {}
}

export type { AlertForDelivery };
