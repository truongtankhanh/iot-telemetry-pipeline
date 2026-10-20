import { describe, expect, it } from 'vitest';
import { stateViewFixture as fixture } from '../api/fixtures/stateView';
import type { StateView } from '../api/types';
import { derivePills, type Pill, type PillInput, portOf } from './pills';

const base = fixture;

function pills(change: (view: StateView) => void = () => {}, input: Partial<PillInput> = {}) {
  const view = structuredClone(base);
  change(view);
  const list = derivePills({
    view,
    link: 'live',
    publishRate: 7.5,
    lastAlertSink: 'ops-command-center',
    ...input,
  });
  // The four ids are fixed, so a lookup by id is never undefined (the index signature would say it may be).
  return Object.fromEntries(list.map((pill) => [pill.id, pill])) as Record<Pill['id'], Pill>;
}

describe('portOf', () => {
  it('reads the port of a URL, and nothing when there is none', () => {
    expect(portOf('http://localhost:3100')).toBe('3100');
    expect(portOf('https://ingest.example')).toBeNull();
    expect(portOf('not a url')).toBeNull();
  });
});

describe('when everything is up', () => {
  it('shows the four pills ok, with the ports and the rate', () => {
    const p = pills();
    expect(p.broker).toMatchObject({ label: 'Broker', detail: ':1883', tone: 'ok', stale: false });
    expect(p.ingest).toMatchObject({ label: 'Ingest', detail: ':3100', tone: 'ok', stale: false });
    expect(p.commandCenter).toMatchObject({
      label: 'Command Center',
      detail: null,
      tone: 'ok',
      stale: false,
    });
    expect(p.running).toMatchObject({
      label: 'Running',
      detail: '5 of 6 devices · 7.5 msg/s',
      tone: 'ok',
    });
  });

  it('lists the pills in the order of the header', () => {
    const order = derivePills({
      view: base,
      link: 'live',
      publishRate: 0,
      lastAlertSink: null,
    }).map((pill) => pill.id);
    expect(order).toEqual(['broker', 'ingest', 'commandCenter', 'running']);
  });
});

describe('the broker', () => {
  it('goes bad when the simulator is not connected to it', () => {
    const p = pills((v) => void (v.broker.connected = false));
    expect(p.broker).toMatchObject({ detail: 'disconnected', tone: 'bad' });
  });
});

describe('ingest', () => {
  it('is not ready when a dependency of its is down, and says which', () => {
    const p = pills((v) => {
      v.ingest.status = 'not-ready';
      v.ingest.database = 'down';
    });
    expect(p.ingest).toMatchObject({ detail: 'not ready · database down', tone: 'warn' });

    const both = pills((v) => {
      v.ingest.status = 'not-ready';
      v.ingest.database = 'down';
      v.ingest.broker = 'down';
    });
    expect(both.ingest.detail).toBe('not ready · database down, broker down');
  });

  it('is unreachable and bad when it does not answer (frame 10)', () => {
    const p = pills((v) => {
      v.ingest.status = 'unreachable';
      v.ingest.alertSink = null;
      v.ingest.database = null;
    });
    expect(p.ingest).toMatchObject({ detail: 'unreachable', tone: 'bad' });
  });

  it('is unknown until it has been asked', () => {
    const p = pills((v) => void (v.ingest.status = 'unknown'));
    expect(p.ingest).toMatchObject({ detail: 'checking', tone: 'unknown' });
  });
});

describe('the command center', () => {
  it('is not configured, and warns, when ingest has no alert sink (frame 10)', () => {
    const p = pills((v) => void (v.ingest.alertSink = 'none'));
    expect(p.commandCenter).toMatchObject({ detail: 'not configured', tone: 'warn', stale: false });
  });

  it('is bad when an alert could not be delivered to it', () => {
    const p = pills((v) => void (v.alerts.alerts[0]!.deliveryStatus = 'failed'));
    expect(p.commandCenter).toMatchObject({ detail: 'delivery failing', tone: 'bad' });
  });

  it('does not call a missing sink a failure, even with a failed delivery on record', () => {
    const p = pills((v) => {
      v.ingest.alertSink = 'none';
      v.alerts.alerts[0]!.deliveryStatus = 'failed';
    });
    expect(p.commandCenter.tone).toBe('warn');
  });

  it('shows the last known sink, stale, while ingest does not answer', () => {
    const down = (v: StateView) => {
      v.ingest.status = 'unreachable';
      v.ingest.alertSink = null;
    };
    expect(pills(down, { lastAlertSink: 'none' }).commandCenter).toMatchObject({
      detail: 'not configured',
      tone: 'warn',
      stale: true,
    });
    expect(pills(down, { lastAlertSink: 'ops-command-center' }).commandCenter).toMatchObject({
      tone: 'ok',
      stale: true,
    });
  });

  it('is unknown when ingest never said anything', () => {
    const p = pills(
      (v) => {
        v.ingest.status = 'unreachable';
        v.ingest.alertSink = null;
      },
      { lastAlertSink: null },
    );
    expect(p.commandCenter).toMatchObject({ detail: 'unknown', tone: 'unknown', stale: true });
  });
});

describe('the engine', () => {
  it('says paused when no device is running, and stopped when the engine is', () => {
    const paused = pills((v) => v.engine.devices.forEach((d) => void (d.state = 'paused')));
    expect(paused.running).toMatchObject({
      label: 'Paused',
      detail: '0 of 6 devices',
      tone: 'warn',
    });

    const stopped = pills((v) => void (v.engine.running = false));
    expect(stopped.running).toMatchObject({ label: 'Stopped', tone: 'warn' });
  });

  it('writes the rate with one decimal', () => {
    expect(pills(() => {}, { publishRate: 3 }).running.detail).toBe('5 of 6 devices · 3.0 msg/s');
  });
});

describe('before data and after the link is lost', () => {
  it('shows every pill unknown while connecting', () => {
    const list = derivePills({
      view: null,
      link: 'connecting',
      publishRate: 0,
      lastAlertSink: null,
    });
    expect(list.map((p) => p.tone)).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
    expect(list.every((p) => p.detail === 'connecting' && !p.stale)).toBe(true);
  });

  it('says there is no data when the link was lost before the first message', () => {
    const list = derivePills({ view: null, link: 'lost', publishRate: 0, lastAlertSink: null });
    expect(list.every((p) => p.detail === 'no data' && p.stale)).toBe(true);
  });

  it('keeps the last data but marks every pill stale when the link is lost', () => {
    const list = derivePills({
      view: base,
      link: 'lost',
      publishRate: 5,
      lastAlertSink: 'ops-command-center',
    });
    expect(list.every((p) => p.stale)).toBe(true);
    expect(list[0]).toMatchObject({ id: 'broker', tone: 'ok', detail: ':1883' }); // the last known value, not a guess
  });
});
