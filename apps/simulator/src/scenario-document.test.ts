import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  lengthS,
  MAX_ANOMALIES,
  MAX_DESCRIPTION_LENGTH,
  MAX_DURATION_S,
  parseAnomalies,
  parseScenarioDocument,
  toAnomalies,
  toAnomalyFlag,
} from './scenario-document.ts';
import { parseAnomaly } from './signals.ts';
import { DEVICES } from './test-support.ts';

const anomaly = (change: Record<string, unknown> = {}) => ({
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  value: 29.2,
  startAt: 20,
  duration: 60,
  ...change,
});

const document = (change: Record<string, unknown> = {}) => ({
  name: 'server-room-overheat',
  description: 'Row A runs hot for a minute, then recovers.',
  anomalies: [anomaly()],
  ...change,
});

const parse = (input: unknown) => parseScenarioDocument(input, { devices: DEVICES });

/** The reason of a refusal; fails the test when the document was accepted. */
function reasonOf(input: unknown): string {
  const result = parse(input);
  assert.equal(result.ok, false, 'the document was accepted');
  return result.ok ? '' : result.reason;
}

describe('parseScenarioDocument', () => {
  it('accepts a document and keeps exactly its fields', () => {
    const result = parse(document());
    assert.deepEqual(result, {
      ok: true,
      scenario: {
        name: 'server-room-overheat',
        description: 'Row A runs hot for a minute, then recovers.',
        anomalies: [
          {
            deviceId: 'dc-env-01',
            metric: 'temperature_c',
            value: 29.2,
            startAt: 20,
            duration: 60,
          },
        ],
      },
    });
  });

  it('keeps a shape when there is one and adds none when there is not', () => {
    const shaped = parse(document({ anomalies: [anomaly({ shape: 'ramp' })] }));
    assert.equal(shaped.ok && shaped.scenario.anomalies[0]?.shape, 'ramp');
    const plain = parse(document());
    assert.equal(plain.ok && 'shape' in (plain.scenario.anomalies[0] ?? {}), false);
  });

  it('takes a missing description as empty', () => {
    const withoutDescription: Record<string, unknown> = document();
    delete withoutDescription.description;
    const result = parse(withoutDescription);
    assert.equal(result.ok && result.scenario.description, '');
  });

  it('refuses what is not an object', () => {
    for (const input of [null, undefined, [], 'text', 3]) {
      assert.match(reasonOf(input), /must be a JSON object/);
    }
  });

  it('refuses a field the format does not have, at both levels', () => {
    assert.match(reasonOf(document({ anomaly: [] })), /"anomaly" is not a known field/);
    assert.match(
      reasonOf(document({ anomalies: [anomaly({ shap: 'ramp' })] })),
      /anomalies\[0\]\.shap is not a known field/,
    );
  });

  describe('the name', () => {
    it('accepts 1 and 64 characters, refuses 65 and an empty name', () => {
      assert.equal(parse(document({ name: 'a' })).ok, true);
      assert.equal(parse(document({ name: 'a'.repeat(64) })).ok, true);
      assert.match(reasonOf(document({ name: 'a'.repeat(65) })), /^name must be 1 to 64/);
      assert.match(reasonOf(document({ name: '' })), /^name must be 1 to 64/);
    });

    it('refuses upper case, spaces, a leading hyphen and anything that is not text', () => {
      for (const name of ['Hot', 'two words', '-hot', 'hot_room', 'hot/room', 7, undefined]) {
        assert.match(reasonOf(document({ name })), /^name must be 1 to 64/);
      }
      assert.equal(parse(document({ name: '1-hot' })).ok, true);
    });

    it('refuses a name that a route already uses', () => {
      assert.match(reasonOf(document({ name: 'import' })), /"import" is a reserved name/);
    });
  });

  describe('the description', () => {
    it('accepts 200 characters and refuses 201', () => {
      assert.equal(parse(document({ description: 'x'.repeat(MAX_DESCRIPTION_LENGTH) })).ok, true);
      assert.match(
        reasonOf(document({ description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 1) })),
        /^description must be text of at most 200/,
      );
      assert.match(reasonOf(document({ description: 4 })), /^description must be text/);
    });
  });

  describe('the list of anomalies', () => {
    const sequence = (count: number) =>
      Array.from({ length: count }, (_, i) => anomaly({ startAt: i * 10, duration: 10 }));

    it('accepts 1 and 50 and refuses none and 51', () => {
      assert.equal(parse(document({ anomalies: sequence(1) })).ok, true);
      assert.equal(parse(document({ anomalies: sequence(MAX_ANOMALIES) })).ok, true);
      assert.match(reasonOf(document({ anomalies: [] })), /anomalies must be a list of 1 to 50/);
      assert.match(
        reasonOf(document({ anomalies: sequence(MAX_ANOMALIES + 1) })),
        /anomalies must be a list of 1 to 50/,
      );
      assert.match(reasonOf(document({ anomalies: 'none' })), /anomalies must be a list/);
    });

    it('names the index of the first anomaly that fails', () => {
      const reason = reasonOf(
        document({ anomalies: [anomaly(), anomaly({ startAt: 100, value: 900 })] }),
      );
      assert.match(reason, /^anomalies\[1\]\.value 900 is outside the range of temperature_c/);
      assert.match(reasonOf(document({ anomalies: ['x'] })), /^anomalies\[0\] must be an object/);
    });
  });

  describe('the device and the metric', () => {
    it('refuses a device the registry does not have', () => {
      assert.match(
        reasonOf(document({ anomalies: [anomaly({ deviceId: 'ghost-01' })] })),
        /^anomalies\[0\]: unknown device "ghost-01"/,
      );
      assert.match(
        reasonOf(document({ anomalies: [anomaly({ deviceId: '' })] })),
        /deviceId must be a non-empty string/,
      );
    });

    it('refuses a metric that does not exist and one the device does not report', () => {
      assert.match(
        reasonOf(document({ anomalies: [anomaly({ metric: 'smell' })] })),
        /^anomalies\[0\]\.metric must be one of temperature_c, humidity_pct, co2_ppm, power_kw, got "smell"/,
      );
      assert.match(
        reasonOf(document({ anomalies: [anomaly({ metric: 'co2_ppm' })] })),
        /device "dc-env-01" does not report co2_ppm/,
      );
    });
  });

  describe('the value against the range of the contract', () => {
    const value = (deviceId: string, metric: string, v: unknown) =>
      parse(document({ anomalies: [anomaly({ deviceId, metric, value: v })] }));

    it('accepts both ends of the range and refuses the first step beyond', () => {
      assert.equal(value('dc-env-01', 'temperature_c', 85).ok, true);
      assert.equal(value('dc-env-01', 'temperature_c', -40).ok, true);
      assert.equal(value('lib-air-01', 'co2_ppm', 10_000).ok, true);
      assert.equal(value('dc-env-01', 'humidity_pct', 0).ok, true);
      assert.equal(value('dc-env-01', 'temperature_c', 85.1).ok, false);
      assert.equal(value('dc-env-01', 'temperature_c', -40.1).ok, false);
      assert.equal(value('lib-air-01', 'co2_ppm', 10_001).ok, false);
      assert.equal(value('dc-env-01', 'humidity_pct', -1).ok, false);
    });

    it('says which value, which metric and what the range is', () => {
      const result = value('dc-env-01', 'temperature_c', 900);
      assert.equal(
        result.ok ? '' : result.reason,
        'anomalies[0].value 900 is outside the range of temperature_c (-40 to 85 °C)',
      );
    });

    it('refuses a value that is not a finite number', () => {
      for (const v of ['5', null, undefined, Number.NaN, Infinity]) {
        assert.match(
          reasonOf(document({ anomalies: [anomaly({ value: v })] })),
          /^anomalies\[0\]\.value must be a finite number/,
        );
      }
    });
  });

  describe('the times', () => {
    it('accepts a start of 0 and refuses a negative one', () => {
      assert.equal(parse(document({ anomalies: [anomaly({ startAt: 0 })] })).ok, true);
      assert.match(
        reasonOf(document({ anomalies: [anomaly({ startAt: -1 })] })),
        /^anomalies\[0\]\.startAt must be a number of seconds, 0 or more/,
      );
      assert.match(
        reasonOf(document({ anomalies: [anomaly({ startAt: '5' })] })),
        /startAt must be a number/,
      );
    });

    it('accepts a duration above 0 up to 3600 and refuses 0 and 3601', () => {
      assert.equal(parse(document({ anomalies: [anomaly({ duration: 0.5 })] })).ok, true);
      assert.equal(
        parse(document({ anomalies: [anomaly({ duration: MAX_DURATION_S })] })).ok,
        true,
      );
      for (const duration of [0, -5, MAX_DURATION_S + 1, Number.NaN]) {
        assert.match(
          reasonOf(document({ anomalies: [anomaly({ duration })] })),
          /^anomalies\[0\]\.duration must be a number of seconds above 0 and at most 3600/,
        );
      }
    });
  });

  describe('the shape', () => {
    it('accepts step, ramp and spike and refuses anything else', () => {
      for (const shape of ['step', 'ramp', 'spike']) {
        assert.equal(parse(document({ anomalies: [anomaly({ shape })] })).ok, true);
      }
      assert.match(
        reasonOf(document({ anomalies: [anomaly({ shape: 'wave' })] })),
        /^anomalies\[0\]\.shape must be one of step, ramp, spike, got "wave"/,
      );
    });
  });

  describe('two anomalies on one device and metric', () => {
    it('refuses windows that play at once, and names both', () => {
      const reason = reasonOf(
        document({
          anomalies: [anomaly(), anomaly({ startAt: 50, duration: 10, value: 30 })],
        }),
      );
      assert.equal(reason, 'anomalies[1] overlaps anomalies[0] on dc-env-01 temperature_c');
    });

    it('accepts windows that only touch, and the same window on another metric or device', () => {
      assert.equal(
        parse(document({ anomalies: [anomaly(), anomaly({ startAt: 80, duration: 10 })] })).ok,
        true,
      );
      assert.equal(
        parse(document({ anomalies: [anomaly(), anomaly({ metric: 'humidity_pct', value: 70 })] }))
          .ok,
        true,
      );
      assert.equal(
        parse(document({ anomalies: [anomaly(), anomaly({ deviceId: 'dc-env-02' })] })).ok,
        true,
      );
    });
  });
});

describe('parseAnomalies', () => {
  const parseList = (input: unknown, max = 100) => parseAnomalies(input, { devices: DEVICES, max });

  /** `count` anomalies on one device and metric that follow each other without overlapping. */
  const sequence = (count: number) =>
    Array.from({ length: count }, (_, i) => anomaly({ startAt: i * 10, duration: 10 }));

  /** The reason of a refusal; fails the test when the list was accepted. */
  function listReason(input: unknown, max = 100): string {
    const result = parseList(input, max);
    assert.equal(result.ok, false, 'the list was accepted');
    return result.ok ? '' : result.reason;
  }

  it('accepts a list and keeps exactly the fields of each anomaly', () => {
    assert.deepEqual(parseList([anomaly(), anomaly({ deviceId: 'dc-env-02', shape: 'ramp' })]), {
      ok: true,
      anomalies: [
        { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2, startAt: 20, duration: 60 },
        {
          deviceId: 'dc-env-02',
          metric: 'temperature_c',
          value: 29.2,
          startAt: 20,
          duration: 60,
          shape: 'ramp',
        },
      ],
    });
  });

  it('takes the cap as a parameter and names it', () => {
    assert.equal(parseList(sequence(100)).ok, true);
    assert.equal(listReason(sequence(101)), 'anomalies must be a list of 1 to 100 anomalies');
    assert.equal(listReason(sequence(4), 3), 'anomalies must be a list of 1 to 3 anomalies');
  });

  it('refuses an empty list and what is not a list', () => {
    for (const input of [[], undefined, null, {}, 'text']) {
      assert.equal(listReason(input), 'anomalies must be a list of 1 to 100 anomalies');
    }
  });

  it('gives an item the refusal a scenario file gives it, word for word', () => {
    const bad = [
      [anomaly({ value: 90 })],
      [anomaly({ deviceId: 'ghost' })],
      [anomaly({ metric: 'power_kw' })],
      [anomaly(), anomaly({ startAt: -1 })],
      [anomaly({ duration: MAX_DURATION_S + 1 })],
      [anomaly({ shape: 'wave' })],
      [anomaly({ shap: 'ramp' })],
    ];
    for (const anomalies of bad) {
      assert.equal(listReason(anomalies), reasonOf(document({ anomalies })));
    }
  });

  it('refuses windows that play at once, and names both', () => {
    assert.equal(
      listReason([anomaly(), anomaly({ startAt: 50, duration: 10, value: 30 })]),
      'anomalies[1] overlaps anomalies[0] on dc-env-01 temperature_c',
    );
  });

  it('leaves the cap of a scenario file where it was', () => {
    assert.equal(parse(document({ anomalies: sequence(MAX_ANOMALIES) })).ok, true);
    assert.equal(
      reasonOf(document({ anomalies: sequence(MAX_ANOMALIES + 1) })),
      `anomalies must be a list of 1 to ${MAX_ANOMALIES} anomalies`,
    );
  });
});

describe('lengthS', () => {
  it('is the end of the last anomaly, not of the last one listed', () => {
    const result = parse(
      document({
        anomalies: [anomaly({ startAt: 0, duration: 110 }), anomaly({ deviceId: 'dc-env-02' })],
      }),
    );
    assert.ok(result.ok);
    assert.equal(lengthS(result.scenario), 110);
  });
});

describe('toAnomalies', () => {
  it('gives copies, so shifting one does not change the scenario', () => {
    const result = parse(document());
    assert.ok(result.ok);
    const copy = toAnomalies(result.scenario);
    copy[0]!.startAt = 999;
    assert.equal(result.scenario.anomalies[0]?.startAt, 20);
  });
});

describe('toAnomalyFlag', () => {
  it('writes the --anomaly flag that parseAnomaly reads back', () => {
    const original = {
      deviceId: 'dc-env-01',
      metric: 'temperature_c' as const,
      value: 29.2,
      startAt: 20,
      duration: 60,
    };
    const flag = toAnomalyFlag(original);
    assert.equal(flag, 'dc-env-01:temperature_c:29.2:20:60');
    assert.deepEqual(parseAnomaly(flag!), original);
  });

  it('writes a flag for an explicit step and none for a shape the flag cannot say', () => {
    const base = {
      deviceId: 'dc-env-01',
      metric: 'temperature_c' as const,
      value: 30,
      startAt: 0,
      duration: 10,
    };
    assert.equal(toAnomalyFlag({ ...base, shape: 'step' }), 'dc-env-01:temperature_c:30:0:10');
    assert.equal(toAnomalyFlag({ ...base, shape: 'ramp' }), undefined);
    assert.equal(toAnomalyFlag({ ...base, shape: 'spike' }), undefined);
  });
});
