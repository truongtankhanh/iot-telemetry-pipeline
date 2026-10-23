import { describe, expect, it } from 'vitest';
import type { FaultsSnapshot } from '../api/types';
import { stateViewFixture } from '../api/fixtures/stateView';
import {
  activeSentence,
  bodyOf,
  checkDraft,
  chosenDevices,
  DEFAULT_DRAFTS,
  deviceIdsOf,
  draftsFrom,
  FAULT_LIMITS,
  FAULT_ROWS,
  faultSentence,
  hasErrors,
  isCurrent,
  isFaultOn,
  MALFORMED_HINTS,
  MALFORMED_KINDS,
  PERCENT_TRACK_MAX,
  percentText,
  scopeSentence,
} from './faultSettings';

const off: FaultsSnapshot = structuredClone(stateViewFixture.engine.faults);
const faults = (changes: Partial<FaultsSnapshot>): FaultsSnapshot => ({ ...off, ...changes });
const devices = stateViewFixture.devices;

describe('the limits and the words (a copy of the simulator’s, pinned here)', () => {
  it('has the limits of apps/simulator/src/faults.ts', () => {
    expect(FAULT_LIMITS).toEqual({
      maxPercent: 100,
      minDelayMs: 1,
      maxDelayMs: 10_000,
      minWindow: 2,
      maxWindow: 10,
      burst: 1000,
      maxBurst: 5000,
      minLinkLossS: 1,
      maxLinkLossS: 3600,
    });
    expect(PERCENT_TRACK_MAX).toBe(20);
  });

  it('has the ten malformed kinds: the nine reasons of the parser and topic, with empty after ts', () => {
    expect([...MALFORMED_KINDS]).toEqual([
      'range',
      'json',
      'shape',
      'seq',
      'ts',
      'empty',
      'metric',
      'value',
      'size',
      'topic',
    ]);
    expect([...MALFORMED_KINDS].sort()).toEqual(
      ['empty', 'json', 'metric', 'range', 'seq', 'shape', 'size', 'topic', 'ts', 'value'].sort(),
    );
    for (const kind of MALFORMED_KINDS) expect(MALFORMED_HINTS[kind].length).toBeGreaterThan(5);
  });

  it('lists the rows in the frame’s order with link loss last', () => {
    expect(FAULT_ROWS.map((row) => row.kind)).toEqual([
      'drop',
      'duplicate',
      'malformed',
      'delay',
      'reorder',
      'burst',
      'link-loss',
    ]);
    for (const row of FAULT_ROWS) {
      expect(row.title).not.toBe('');
      expect(row.description).not.toBe('');
    }
  });

  it('says in the descriptions only what the engine does', () => {
    const text = FAULT_ROWS.map((row) => row.description).join(' ');
    expect(text).toMatch(/seq skips/);
    expect(text).not.toMatch(/Swap neighbouring/);
  });
});

describe('draftsFrom', () => {
  it('starts from the defaults of the frame when nothing is on', () => {
    expect(draftsFrom(off)).toEqual(DEFAULT_DRAFTS);
    expect(DEFAULT_DRAFTS.drop.percent).toBe(5);
    expect(DEFAULT_DRAFTS.duplicate.percent).toBe(2);
    expect(DEFAULT_DRAFTS.malformed).toEqual({ percent: 3, kinds: ['range'] });
  });

  it('takes the settings of a fault that is on from the engine', () => {
    const drafts = draftsFrom(
      faults({
        drop: { percent: 12 },
        malformed: { percent: 7, kinds: ['json', 'seq'] },
        delay: { delayMs: 800, jitterMs: 50 },
        reorder: { window: 6 },
        linkLoss: { since: '2026-10-23T08:00:00.000Z', forS: 30 },
      }),
    );
    expect(drafts.drop).toEqual({ percent: 12 });
    expect(drafts.malformed).toEqual({ percent: 7, kinds: ['json', 'seq'] });
    expect(drafts.delay).toEqual({ delayMs: 800, jitterMs: 50 });
    expect(drafts.reorder).toEqual({ window: 6 });
    expect(drafts['link-loss']).toEqual({ forS: 30 });
    expect(drafts.duplicate).toEqual(DEFAULT_DRAFTS.duplicate);
  });

  it('keeps what the person had in a control for a fault that is off', () => {
    const previous = {
      ...DEFAULT_DRAFTS,
      drop: { percent: 9 },
      delay: { delayMs: 40, jitterMs: 4 },
    };
    const drafts = draftsFrom(faults({ duplicate: { percent: 3 } }), previous);
    expect(drafts.drop).toEqual({ percent: 9 });
    expect(drafts.delay).toEqual({ delayMs: 40, jitterMs: 4 });
    expect(drafts.duplicate).toEqual({ percent: 3 });
  });

  it('does not share the list of kinds with the engine’s state or with the previous drafts', () => {
    const engine = faults({ malformed: { percent: 3, kinds: ['range'] } });
    const drafts = draftsFrom(engine);
    drafts.malformed.kinds.push('json');
    expect(engine.malformed?.kinds).toEqual(['range']);
    const kept = draftsFrom(off, DEFAULT_DRAFTS);
    kept.malformed.kinds.push('json');
    expect(DEFAULT_DRAFTS.malformed.kinds).toEqual(['range']);
  });
});

describe('checkDraft', () => {
  it('accepts a percentage above 0 and at most 100, and names the field otherwise', () => {
    for (const percent of [0.1, 5, 20, 100]) {
      expect(hasErrors(checkDraft('drop', { percent }))).toBe(false);
      expect(hasErrors(checkDraft('duplicate', { percent }))).toBe(false);
    }
    for (const percent of [0, -1, 100.5, null, Number.NaN]) {
      expect(checkDraft('drop', { percent }).percent).toMatch(/percentage/);
    }
  });

  it('malformed needs a percentage and at least one kind', () => {
    expect(checkDraft('malformed', { percent: 3, kinds: ['range'] })).toEqual({});
    expect(checkDraft('malformed', { percent: 3, kinds: [] })).toEqual({
      kinds: 'Choose at least one kind',
    });
    expect(Object.keys(checkDraft('malformed', { percent: null, kinds: [] })).sort()).toEqual([
      'kinds',
      'percent',
    ]);
  });

  it('delay is 1 to 10,000 ms, and the jitter is 0 up to the delay', () => {
    expect(checkDraft('delay', { delayMs: 1, jitterMs: 0 })).toEqual({});
    expect(checkDraft('delay', { delayMs: 10_000, jitterMs: 10_000 })).toEqual({});
    expect(checkDraft('delay', { delayMs: 0, jitterMs: 0 }).delayMs).toMatch(/from 1 to 10,000 ms/);
    expect(checkDraft('delay', { delayMs: 10_001, jitterMs: 0 }).delayMs).toBeDefined();
    expect(checkDraft('delay', { delayMs: null, jitterMs: 0 }).delayMs).toBeDefined();
    expect(checkDraft('delay', { delayMs: 100, jitterMs: 101 }).jitterMs).toMatch(/0 to the delay/);
    expect(checkDraft('delay', { delayMs: 100, jitterMs: -1 }).jitterMs).toBeDefined();
    expect(checkDraft('delay', { delayMs: 100, jitterMs: null }).jitterMs).toBeDefined();
  });

  it('reorder is a whole window of 2 to 10', () => {
    for (const window of [2, 10]) expect(checkDraft('reorder', { window })).toEqual({});
    for (const window of [1, 11, 2.5, null]) {
      expect(checkDraft('reorder', { window }).window).toMatch(/whole number from 2 to 10/);
    }
  });

  it('link loss may have no automatic restore, or one of 1 to 3,600 seconds', () => {
    expect(checkDraft('link-loss', { forS: null })).toEqual({});
    expect(checkDraft('link-loss', { forS: 1 })).toEqual({});
    expect(checkDraft('link-loss', { forS: 3600 })).toEqual({});
    for (const forS of [0, 3601, -2]) {
      expect(checkDraft('link-loss', { forS }).forS).toMatch(/1 to 3,600 seconds/);
    }
  });
});

describe('bodyOf', () => {
  it('makes the body of each kind from a draft that passed', () => {
    expect(bodyOf('drop', { percent: 5 })).toEqual({ percent: 5 });
    expect(bodyOf('duplicate', { percent: 2 })).toEqual({ percent: 2 });
    expect(bodyOf('delay', { delayMs: 500, jitterMs: 100 })).toEqual({
      delayMs: 500,
      jitterMs: 100,
    });
    expect(bodyOf('reorder', { window: 4 })).toEqual({ window: 4 });
    expect(bodyOf('malformed', { percent: 3, kinds: ['json', 'range'] })).toEqual({
      percent: 3,
      kinds: ['json', 'range'],
    });
  });

  it('leaves out the restore time of link loss when there is none', () => {
    expect(bodyOf('link-loss', { forS: null })).toEqual({});
    expect(bodyOf('link-loss', { forS: 30 })).toEqual({ forS: 30 });
  });

  it('does not share the list of kinds with the draft', () => {
    const draft = { percent: 3, kinds: ['range' as const] };
    const body = bodyOf('malformed', draft);
    body.kinds.push('json');
    expect(draft.kinds).toEqual(['range']);
  });
});

describe('the sentences', () => {
  it('says nothing for a fault that is off', () => {
    for (const kind of [
      'drop',
      'duplicate',
      'malformed',
      'delay',
      'reorder',
      'link-loss',
    ] as const) {
      expect(faultSentence(kind, off)).toBeNull();
    }
  });

  it('says what a fault that is on does, from the engine’s settings', () => {
    const on = faults({
      drop: { percent: 5 },
      duplicate: { percent: 0.5 },
      malformed: { percent: 3, kinds: ['range', 'json'] },
      delay: { delayMs: 1500, jitterMs: 200 },
      reorder: { window: 4 },
      linkLoss: { since: '2026-10-23T08:00:00.000Z', forS: null },
    });
    expect(faultSentence('drop', on)).toBe('5 % of messages are not sent');
    expect(faultSentence('duplicate', on)).toBe('0.5 % of messages are sent twice');
    expect(faultSentence('malformed', on)).toMatch(/3 % .* \(range, json\)/);
    expect(faultSentence('delay', on)).toBe('Each message waits 1,500 ms, give or take 200 ms');
    expect(faultSentence('reorder', on)).toMatch(/4 messages of a device/);
    expect(faultSentence('link-loss', on)).toBe('The link is down until it is restored');
    expect(faultSentence('link-loss', faults({ linkLoss: { since: 'x', forS: 30 } }))).toBe(
      'The link is down and restores itself after 30 s',
    );
  });

  it('writes a percentage without noise', () => {
    expect(percentText(5)).toBe('5');
    expect(percentText(0.5)).toBe('0.5');
    expect(percentText(2.256)).toBe('2.26');
  });

  it('writes the banner in the singular and the plural', () => {
    expect(activeSentence({ activeCount: 3, deviceCount: 4 })).toBe(
      '3 faults are active on 4 devices',
    );
    expect(activeSentence({ activeCount: 1, deviceCount: 1 })).toBe(
      '1 fault is active on 1 device',
    );
  });
});

describe('the scope', () => {
  it('shows the chosen devices of a selection and none for all running', () => {
    expect(chosenDevices({ mode: 'running' })).toEqual([]);
    const scope = { mode: 'selected' as const, deviceIds: ['dc-env-01', 'lib-air-01'] };
    expect(chosenDevices(scope)).toEqual(['dc-env-01', 'lib-air-01']);
    expect(chosenDevices(scope)).not.toBe(scope.deviceIds);
  });

  it('expands a zone or a class to the devices that have it, in the registry’s order, once each', () => {
    const zone = devices[0]!.zoneCode;
    const inZone = devices.filter((d) => d.zoneCode === zone).map((d) => d.id);
    expect(deviceIdsOf(devices, 'zone', [zone])).toEqual(inZone);
    expect(deviceIdsOf(devices, 'zone', [zone, zone])).toEqual(inZone);
    const kind = devices[0]!.kind;
    expect(deviceIdsOf(devices, 'class', [kind])).toEqual(
      devices.filter((d) => d.kind === kind).map((d) => d.id),
    );
    expect(deviceIdsOf(devices, 'device', ['lib-air-01', 'dc-env-01'])).toEqual(
      devices.filter((d) => ['lib-air-01', 'dc-env-01'].includes(d.id)).map((d) => d.id),
    );
    expect(deviceIdsOf(devices, 'device', [])).toEqual([]);
    expect(deviceIdsOf(devices, 'device', ['ghost'])).toEqual([]);
  });

  it('says what the scope is', () => {
    expect(scopeSentence(faults({ deviceCount: 5 }))).toMatch(
      /running when a message is built; 5 devices are now/,
    );
    expect(scopeSentence(faults({ deviceCount: 1 }))).toMatch(/1 device is now/);
    expect(
      scopeSentence(
        faults({ scope: { mode: 'selected', deviceIds: ['dc-env-01'] }, deviceCount: 1 }),
      ),
    ).toMatch(/^1 device chosen\./);
  });
});

describe('isCurrent', () => {
  it('is false for a fault that is off, whatever the body', () => {
    expect(isCurrent('drop', { percent: 5 }, off)).toBe(false);
    expect(isCurrent('link-loss', {}, off)).toBe(false);
  });

  it('is true when the engine has exactly these settings', () => {
    const on = faults({
      drop: { percent: 5 },
      duplicate: { percent: 2 },
      malformed: { percent: 3, kinds: ['range', 'json'] },
      delay: { delayMs: 500, jitterMs: 100 },
      reorder: { window: 4 },
      linkLoss: { since: 'x', forS: null },
    });
    expect(isCurrent('drop', { percent: 5 }, on)).toBe(true);
    expect(isCurrent('duplicate', { percent: 2 }, on)).toBe(true);
    expect(isCurrent('malformed', { percent: 3, kinds: ['range', 'json'] }, on)).toBe(true);
    expect(isCurrent('delay', { delayMs: 500, jitterMs: 100 }, on)).toBe(true);
    expect(isCurrent('reorder', { window: 4 }, on)).toBe(true);
    expect(isCurrent('link-loss', {}, on)).toBe(true);
  });

  it('is false when one setting differs', () => {
    const on = faults({
      drop: { percent: 5 },
      malformed: { percent: 3, kinds: ['range', 'json'] },
      delay: { delayMs: 500, jitterMs: 100 },
      reorder: { window: 4 },
      linkLoss: { since: 'x', forS: 30 },
    });
    expect(isCurrent('drop', { percent: 6 }, on)).toBe(false);
    expect(isCurrent('malformed', { percent: 3, kinds: ['json', 'range'] }, on)).toBe(false);
    expect(isCurrent('malformed', { percent: 3, kinds: ['range'] }, on)).toBe(false);
    expect(isCurrent('delay', { delayMs: 500, jitterMs: 99 }, on)).toBe(false);
    expect(isCurrent('reorder', { window: 5 }, on)).toBe(false);
    expect(isCurrent('link-loss', {}, on)).toBe(false);
    expect(isCurrent('link-loss', { forS: 30 }, on)).toBe(true);
  });
});

describe('isFaultOn', () => {
  it('says whether the engine has each fault on, and link loss while the link is down', () => {
    for (const kind of [
      'drop',
      'duplicate',
      'malformed',
      'delay',
      'reorder',
      'link-loss',
    ] as const) {
      expect(isFaultOn(kind, off)).toBe(false);
    }
    const on = faults({
      drop: { percent: 5 },
      reorder: { window: 3 },
      linkLoss: { since: 'x', forS: null },
    });
    expect(isFaultOn('drop', on)).toBe(true);
    expect(isFaultOn('reorder', on)).toBe(true);
    expect(isFaultOn('link-loss', on)).toBe(true);
    expect(isFaultOn('delay', on)).toBe(false);
  });
});
