import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALERT_CAP, AlertObserver, type IngestAlert, parseAlerts } from './alert-observer.ts';

const T = (second: number) => `2026-10-20T08:00:${String(second).padStart(2, '0')}.000Z`;

function alert(overrides: Partial<IngestAlert> = {}): IngestAlert {
  return {
    id: '1',
    deviceId: 'dc-env-01',
    ruleId: 'server-room-hot',
    metric: 'temperature_c',
    severity: 'high',
    title: 'Server room temperature high',
    status: 'open',
    openedAt: '2026-10-20T07:59:30.000Z',
    openedValue: 29.3,
    clearedAt: null,
    clearedValue: null,
    externalRef: null,
    deliveryStatus: 'pending',
    deliveryAttempts: 0,
    deliveryError: null,
    ...overrides,
  };
}

const cleared = (overrides: Partial<IngestAlert> = {}) =>
  alert({
    status: 'cleared',
    clearedAt: '2026-10-20T08:01:30.000Z',
    clearedValue: 25.1,
    ...overrides,
  });

const kinds = (events: { kind: string }[]) => events.map((e) => e.kind);

/** An observer that has already taken its baseline over `existing`. */
function baselined(existing: IngestAlert[] = []): AlertObserver {
  const observer = new AlertObserver();
  observer.observe(existing, T(0));
  return observer;
}

describe('AlertObserver baseline', () => {
  it('lists the alerts already in ingest as preexisting, with no events and no observed times', () => {
    const observer = new AlertObserver();
    const { events, view, changed } = observer.observe(
      [alert({ id: '5', externalRef: 'inc-5', deliveryStatus: 'delivered' })],
      T(1),
    );
    assert.deepEqual(events, []);
    assert.equal(changed, true);
    assert.equal(view.length, 1);
    assert.equal(view[0]?.preexisting, true);
    assert.deepEqual(view[0]?.observed, {
      openedAt: null,
      clearedAt: null,
      delivered: { opened: null, cleared: null },
      incident: null,
    });
    // The ingest fields are still there, so the page can show what ingest says.
    assert.equal(view[0]?.deliveryStatus, 'delivered');
  });

  it('baselines an empty ingest too: what appears afterwards is new', () => {
    const observer = baselined([]);
    const { events } = observer.observe([alert()], T(2));
    assert.equal(kinds(events)[0], 'alert-opened');
  });
});

describe('AlertObserver new alerts', () => {
  it('records the first sight of an alert opening, with the time of the read', () => {
    const observer = baselined();
    const { events, view, changed } = observer.observe([alert()], T(2));
    assert.deepEqual(kinds(events), ['alert-opened', 'delivery']);
    assert.deepEqual(events[0]?.data, {
      alertId: '1',
      deviceId: 'dc-env-01',
      ruleId: 'server-room-hot',
      metric: 'temperature_c',
      severity: 'high',
      title: 'Server room temperature high',
    });
    assert.deepEqual(events[1]?.data, { alertId: '1', phase: 'opened', status: 'pending' });
    assert.equal(changed, true);
    assert.equal(view[0]?.preexisting, false);
    assert.equal(view[0]?.observed.openedAt, T(2));
    assert.equal(view[0]?.observed.delivered.opened, null);
  });

  it('records its delivery becoming delivered and the incident id appearing, once each', () => {
    const observer = baselined();
    observer.observe([alert()], T(2));

    const delivered = observer.observe(
      [alert({ deliveryStatus: 'delivered', deliveryAttempts: 1, externalRef: 'inc-1' })],
      T(3),
    );
    assert.deepEqual(kinds(delivered.events), ['delivery', 'incident']);
    assert.deepEqual(delivered.events[0]?.data, {
      alertId: '1',
      phase: 'opened',
      status: 'delivered',
    });
    assert.deepEqual(delivered.events[1]?.data, { alertId: '1', externalRef: 'inc-1' });
    assert.equal(delivered.view[0]?.observed.delivered.opened, T(3));
    assert.equal(delivered.view[0]?.observed.incident, T(3));

    const again = observer.observe(
      [alert({ deliveryStatus: 'delivered', deliveryAttempts: 1, externalRef: 'inc-1' })],
      T(4),
    );
    assert.deepEqual(again.events, []);
    assert.equal(again.changed, false);
    assert.equal(again.view[0]?.observed.delivered.opened, T(3));
    assert.equal(again.view[0]?.observed.incident, T(3));
  });

  it('records an alert that opened and cleared between two reads as both events', () => {
    const observer = baselined();
    const { events, view } = observer.observe([cleared()], T(2));
    assert.deepEqual(kinds(events), ['alert-opened', 'alert-cleared', 'delivery']);
    // The delivery status it carries belongs to the cleared event.
    assert.equal(events[2]?.data.phase, 'cleared');
    assert.equal(view[0]?.observed.openedAt, T(2));
    assert.equal(view[0]?.observed.clearedAt, T(2));
  });

  it('records a delivery that was already delivered at first sight', () => {
    const observer = baselined();
    const { events, view } = observer.observe(
      [alert({ deliveryStatus: 'delivered', externalRef: 'inc-1' })],
      T(2),
    );
    assert.deepEqual(kinds(events), ['alert-opened', 'delivery', 'incident']);
    assert.equal(view[0]?.observed.delivered.opened, T(2));
  });

  it('reports a skipped delivery (no command center) as a delivery event without a delivered time', () => {
    const observer = baselined();
    const { events, view } = observer.observe([alert({ deliveryStatus: 'skipped' })], T(2));
    assert.deepEqual(events[1]?.data, { alertId: '1', phase: 'opened', status: 'skipped' });
    assert.equal(view[0]?.observed.delivered.opened, null);
  });

  it('makes no delivery event for an alert without an outbox row', () => {
    const observer = baselined();
    const { events } = observer.observe([alert({ deliveryStatus: null })], T(2));
    assert.deepEqual(kinds(events), ['alert-opened']);
  });
});

describe('AlertObserver clearing and the two delivery phases', () => {
  it('keeps the time the opened event was delivered when the cleared event replaces its status', () => {
    const observer = baselined();
    observer.observe([alert()], T(2));
    observer.observe([alert({ deliveryStatus: 'delivered', externalRef: 'inc-1' })], T(3));

    const clearing = observer.observe(
      [cleared({ deliveryStatus: 'pending', externalRef: 'inc-1' })],
      T(4),
    );
    assert.deepEqual(kinds(clearing.events), ['alert-cleared', 'delivery']);
    assert.deepEqual(clearing.events[1]?.data, {
      alertId: '1',
      phase: 'cleared',
      status: 'pending',
    });
    assert.equal(clearing.view[0]?.observed.clearedAt, T(4));
    assert.equal(clearing.view[0]?.observed.delivered.opened, T(3));
    assert.equal(clearing.view[0]?.observed.delivered.cleared, null);

    const done = observer.observe(
      [cleared({ deliveryStatus: 'delivered', externalRef: 'inc-1' })],
      T(5),
    );
    assert.deepEqual(kinds(done.events), ['delivery']);
    assert.equal(done.view[0]?.observed.delivered.cleared, T(5));
    assert.equal(done.view[0]?.observed.delivered.opened, T(3));
  });

  it('records a preexisting open alert clearing later, without claiming it saw it open', () => {
    const observer = baselined([alert({ deliveryStatus: 'delivered', externalRef: 'inc-9' })]);
    const { events, view } = observer.observe(
      [cleared({ deliveryStatus: 'pending', externalRef: 'inc-9' })],
      T(2),
    );
    // No incident event: the id was already there at the baseline.
    assert.deepEqual(kinds(events), ['alert-cleared', 'delivery']);
    assert.equal(view[0]?.preexisting, true);
    assert.equal(view[0]?.observed.openedAt, null);
    assert.equal(view[0]?.observed.clearedAt, T(2));
    assert.equal(view[0]?.observed.incident, null);
  });

  it('records a change of a preexisting alert delivery after the baseline', () => {
    const observer = baselined([alert({ deliveryStatus: 'pending' })]);
    const { events, view } = observer.observe(
      [alert({ deliveryStatus: 'delivered', externalRef: 'inc-1' })],
      T(2),
    );
    assert.deepEqual(kinds(events), ['delivery', 'incident']);
    assert.equal(view[0]?.observed.delivered.opened, T(2));
  });
});

describe('AlertObserver quiet reads', () => {
  it('makes no events and no change for an identical read', () => {
    const observer = baselined([alert()]);
    const { events, changed } = observer.observe([alert()], T(2));
    assert.deepEqual(events, []);
    assert.equal(changed, false);
  });

  it('reports a change with no event when only the attempts or the error changed', () => {
    const observer = baselined();
    observer.observe(
      [alert({ deliveryStatus: 'failed', deliveryAttempts: 1, deliveryError: 'boom' })],
      T(2),
    );

    const retried = observer.observe(
      [alert({ deliveryStatus: 'failed', deliveryAttempts: 2, deliveryError: 'boom' })],
      T(3),
    );
    assert.deepEqual(retried.events, []);
    assert.equal(retried.changed, true);
    assert.equal(retried.view[0]?.deliveryAttempts, 2);
  });

  it('keeps an alert that is missing from a later read (it fell off the page)', () => {
    const observer = baselined();
    observer.observe([alert({ id: '1' }), alert({ id: '2', openedAt: T(1) })], T(2));
    const { view, events } = observer.observe([alert({ id: '2', openedAt: T(1) })], T(3));
    assert.deepEqual(events, []);
    assert.deepEqual(
      view.map((a) => a.id),
      ['2', '1'],
    );
  });
});

describe('AlertObserver ordering and bound', () => {
  it('emits events oldest alert first and lists the view newest first', () => {
    const observer = baselined();
    const older = alert({ id: '1', openedAt: T(1), deliveryStatus: null });
    const newer = alert({ id: '2', openedAt: T(2), deliveryStatus: null });
    const { events, view } = observer.observe([newer, older], T(3)); // ingest sends newest first
    assert.deepEqual(
      events.map((e) => e.data.alertId),
      ['1', '2'],
    );
    assert.deepEqual(
      view.map((a) => a.id),
      ['2', '1'],
    );
  });

  it('orders alerts opened at the same instant by id, comparing the ids as numbers', () => {
    const observer = baselined();
    const { view } = observer.observe(
      [alert({ id: '9', deliveryStatus: null }), alert({ id: '10', deliveryStatus: null })],
      T(3),
    );
    assert.deepEqual(
      view.map((a) => a.id),
      ['10', '9'],
    );
  });

  it('keeps the 500 most recently opened alerts', () => {
    const observer = baselined();
    const start = Date.UTC(2026, 9, 20, 7, 0, 0);
    const many = Array.from({ length: ALERT_CAP + 1 }, (_, i) =>
      alert({
        id: String(i + 1),
        openedAt: new Date(start + i * 1000).toISOString(),
        deliveryStatus: null,
      }),
    );
    const { view } = observer.observe(many, T(5));
    assert.equal(view.length, ALERT_CAP);
    assert.equal(view[0]?.id, String(ALERT_CAP + 1));
    assert.equal(view.at(-1)?.id, '2');
  });

  it('returns a view that later reads do not change', () => {
    const observer = baselined();
    const first = observer.observe([alert()], T(2)).view;
    observer.observe([alert({ deliveryStatus: 'delivered' })], T(3));
    assert.equal(first[0]?.observed.delivered.opened, null);
  });
});

describe('parseAlerts', () => {
  const wire = {
    id: '7',
    deviceId: 'dc-env-01',
    ruleId: 'server-room-hot',
    metric: 'temperature_c',
    severity: 'high',
    title: 'Server room temperature high',
    status: 'cleared',
    openedAt: '2026-10-16T08:00:26.000Z',
    openedValue: 29.3,
    clearedAt: '2026-10-16T08:01:30.000Z',
    clearedValue: 25.1,
    externalRef: 'c3a1',
    deliveryStatus: 'delivered',
    deliveryAttempts: 1,
    deliveryError: null,
  };

  it('reads the documented shape', () => {
    assert.deepEqual(parseAlerts([wire]), [wire]);
    assert.deepEqual(parseAlerts([]), []);
  });

  it('reads nulls and absent optional fields as null', () => {
    const [parsed] =
      parseAlerts([
        {
          ...wire,
          clearedAt: null,
          clearedValue: null,
          externalRef: null,
          deliveryStatus: null,
          status: 'open',
        },
      ]) ?? [];
    assert.equal(parsed?.clearedAt, null);
    assert.equal(parsed?.deliveryStatus, null);

    const sparse: Record<string, unknown> = { ...wire };
    delete sparse.deliveryStatus;
    delete sparse.deliveryError;
    const [lenient] = parseAlerts([sparse]) ?? [];
    assert.equal(lenient?.deliveryStatus, null);
    assert.equal(lenient?.deliveryError, null);
  });

  it('refuses a reply that is not an array of well-formed alerts, as a whole', () => {
    assert.equal(parseAlerts({ alerts: [] }), undefined);
    assert.equal(parseAlerts(null), undefined);
    assert.equal(parseAlerts('[]'), undefined);
    assert.equal(parseAlerts([wire, { ...wire, id: undefined }]), undefined);
    assert.equal(parseAlerts([{ ...wire, id: 7 }]), undefined); // ids are strings (bigint)
    assert.equal(parseAlerts([{ ...wire, status: 'closed' }]), undefined);
    assert.equal(parseAlerts([{ ...wire, openedValue: '29.3' }]), undefined);
    assert.equal(parseAlerts([null]), undefined);
  });
});

describe('AlertObserver.get', () => {
  it('returns one tracked alert with its observed times, or undefined', () => {
    const observer = baselined();
    observer.observe([alert({ id: '7' })], T(5));

    const found = observer.get('7');
    assert.equal(found?.id, '7');
    assert.equal(found?.preexisting, false);
    assert.equal(found?.observed.openedAt, T(5));
    assert.equal(observer.get('99'), undefined);
  });

  it('returns a copy: changing it does not change what the observer keeps', () => {
    const observer = baselined();
    observer.observe([alert({ id: '7' })], T(5));

    const found = observer.get('7');
    assert.ok(found);
    found.observed.delivered.opened = 'tampered';
    found.title = 'tampered';
    assert.equal(observer.get('7')?.observed.delivered.opened, null);
    assert.equal(observer.get('7')?.title, 'Server room temperature high');
  });
});
