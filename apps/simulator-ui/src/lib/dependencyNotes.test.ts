import { describe, expect, it } from 'vitest';
import fixture from '../api/fixtures/state-view.json';
import type { StateView } from '../api/types';
import { dependencyNotes } from './dependencyNotes';

const base = fixture as StateView;
const notes = (
  change: (view: StateView) => void = () => {},
  lastAlertSink: string | null = 'ops-command-center',
) => {
  const view = structuredClone(base);
  change(view);
  return dependencyNotes(view, lastAlertSink);
};
const ids = (list: ReturnType<typeof notes>) => list.map((n) => n.id);

describe('dependencyNotes', () => {
  it('says nothing when everything answers', () => {
    expect(notes()).toEqual([]);
    expect(dependencyNotes(null, null)).toEqual([]);
  });

  it('says the simulator is not publishing when it is not connected to the broker', () => {
    const [note] = notes((v) => void (v.broker.connected = false));
    expect(note).toMatchObject({ id: 'broker-disconnected', tone: 'bad' });
    expect(note?.text).toMatch(/Nothing is being published/);
  });

  it('says ingest is unreachable, since when, where, and that publishing goes on (frame 10)', () => {
    const [note] = notes((v) => {
      v.ingest.status = 'unreachable';
      v.ingest.alertSink = null;
      v.ingest.detail = 'ECONNREFUSED';
      v.ingest.since = '2026-10-20T09:21:07.000Z';
    });
    expect(note).toMatchObject({
      id: 'ingest-unreachable',
      tone: 'bad',
      title: 'Ingest is unreachable',
    });
    expect(note?.text).toContain('http://localhost:3100');
    expect(note?.text).toContain('(ECONNREFUSED)');
    expect(note?.text).toMatch(/since \d{2}:\d{2}:\d{2}/);
    expect(note?.text).toMatch(/Publishing continues/);
  });

  it('says which dependency of ingest is down', () => {
    const one = notes((v) => {
      v.ingest.status = 'not-ready';
      v.ingest.database = 'down';
    });
    expect(one[0]?.text).toMatch(/the database is down/);
    const both = notes((v) => {
      v.ingest.status = 'not-ready';
      v.ingest.database = 'down';
      v.ingest.broker = 'down';
    });
    expect(both[0]?.text).toMatch(/the database and the broker are down/);
  });

  it('says there is no alert sink, and what that means for incidents (frame 10)', () => {
    const [note] = notes((v) => void (v.ingest.alertSink = 'none'));
    expect(note).toMatchObject({ id: 'no-alert-sink', tone: 'warn' });
    expect(note?.text).toMatch(/marked skipped/);
    expect(note?.text).toMatch(/no incident is created/);
  });

  it('reports the last known alert sink while ingest is unreachable, as the last known', () => {
    const down = (v: StateView) => {
      v.ingest.status = 'unreachable';
      v.ingest.alertSink = null;
    };
    const list = notes(down, 'none');
    expect(ids(list)).toEqual(['ingest-unreachable', 'no-alert-sink']);
    expect(list[1]?.text).toMatch(/The last time ingest answered/);
    expect(ids(notes(down, null))).toEqual(['ingest-unreachable']);
  });

  it('says a delivery is failing only when there is a sink to fail', () => {
    const failing = (v: StateView) => void (v.alerts.alerts[0]!.deliveryStatus = 'failed');
    expect(ids(notes(failing))).toEqual(['delivery-failing']);
    expect(
      ids(
        notes((v) => {
          failing(v);
          v.ingest.alertSink = 'none';
        }),
      ),
    ).toEqual(['no-alert-sink']);
  });

  it('can have several at once, in the order of the pipeline', () => {
    const list = notes((v) => {
      v.broker.connected = false;
      v.ingest.status = 'unreachable';
      v.ingest.alertSink = null;
    }, 'none');
    expect(ids(list)).toEqual(['broker-disconnected', 'ingest-unreachable', 'no-alert-sink']);
  });
});
