import { describe, expect, it } from 'vitest';
import type { Anomaly, DeviceInfo } from '../api/types';
import { addEntry, EMPTY_DOC, fromAnomalies, setDescription, setName } from './timelineEditor';
import {
  isValid,
  MAX_DESCRIPTION_LENGTH,
  nameProblem,
  problemSummary,
  validateDoc,
} from './timelineValidation';

const devices: DeviceInfo[] = [
  {
    id: 'dc-env-01',
    kind: 'server_room',
    zoneCode: 'BLD-DC',
    metrics: ['temperature_c', 'humidity_pct'],
  },
  {
    id: 'lib-air-01',
    kind: 'indoor_air',
    zoneCode: 'BLD-LIB',
    metrics: ['co2_ppm', 'temperature_c', 'humidity_pct'],
  },
];

const hot: Anomaly = {
  deviceId: 'dc-env-01',
  metric: 'temperature_c',
  value: 29.2,
  startAt: 20,
  duration: 60,
};

const saved = { devices, taken: null } as const;

/** A named copy holding the given anomalies. */
const docOf = (name: string, anomalies: Anomaly[]) => setName(fromAnomalies(anomalies), name);

describe('nameProblem', () => {
  it('accepts what the simulator accepts: 1 to 64 of lower-case letters, digits and hyphens', () => {
    expect(nameProblem('a')).toBeNull();
    expect(nameProblem('bad-afternoon-9')).toBeNull();
    expect(nameProblem('9lives')).toBeNull();
    expect(nameProblem('a'.repeat(64))).toBeNull();
  });

  it('asks for a name when there is none', () => {
    expect(nameProblem('')).toBe('Give the scenario a name');
  });

  it('refuses upper case, spaces, dots, slashes, a leading hyphen and 65 characters', () => {
    for (const bad of ['Hot', 'a b', 'a.json', 'a/b', '-a', '_a', 'a'.repeat(65), 'é']) {
      expect(nameProblem(bad), bad).toMatch(/^Use 1 to 64 characters/);
    }
  });

  it('refuses the name a route uses and a name that exists', () => {
    expect(nameProblem('import')).toBe('"import" is a reserved name');
    expect(nameProblem('hot', ['hot', 'cold'])).toBe('A scenario named "hot" already exists');
    expect(nameProblem('warm', ['hot', 'cold'])).toBeNull();
  });
});

describe('validateDoc: the document', () => {
  it('has nothing to say about a good scenario', () => {
    const errors = validateDoc(docOf('ok', [hot]), saved);
    expect(errors).toEqual({ entries: {} });
    expect(isValid(errors)).toBe(true);
    expect(problemSummary(errors)).toBeNull();
  });

  it('asks for a name, and for at least one anomaly', () => {
    const errors = validateDoc(EMPTY_DOC, saved);
    expect(errors.name).toBe('Give the scenario a name');
    expect(errors.count).toBe('Add at least one anomaly');
    expect(isValid(errors)).toBe(false);
  });

  it('checks the name against the existing ones only for a scenario that is not saved yet', () => {
    const doc = docOf('hot', [hot]);
    expect(validateDoc(doc, { devices, taken: ['hot'] }).name).toBe(
      'A scenario named "hot" already exists',
    );
    expect(validateDoc(doc, saved).name).toBeUndefined();
  });

  it('holds the description to 200 characters', () => {
    const doc = docOf('ok', [hot]);
    expect(
      validateDoc(setDescription(doc, 'x'.repeat(MAX_DESCRIPTION_LENGTH)), saved).description,
    ).toBeUndefined();
    expect(validateDoc(setDescription(doc, 'x'.repeat(201)), saved).description).toBe(
      'Description is at most 200 characters',
    );
  });

  it('holds the scenario to 50 anomalies', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ ...hot, startAt: i * 100, duration: 10 }));
    expect(validateDoc(docOf('many', many), saved).count).toBe(
      'A scenario holds at most 50 anomalies',
    );
    expect(validateDoc(docOf('many', many.slice(0, 50)), saved).count).toBeUndefined();
  });
});

describe('validateDoc: each anomaly', () => {
  const errorsOf = (anomaly: Anomaly) =>
    validateDoc(docOf('ok', [anomaly]), saved).entries['a1'] ?? {};

  it('names a device the registry does not have and a metric the device does not report', () => {
    expect(errorsOf({ ...hot, deviceId: 'ghost-01' }).deviceId).toBe(
      'ghost-01 is not in the registry',
    );
    expect(errorsOf({ ...hot, metric: 'co2_ppm' }).metric).toBe(
      'dc-env-01 does not report co2_ppm',
    );
  });

  it('holds the value to the range of the contract, with the unit', () => {
    expect(errorsOf({ ...hot, value: 900 }).value).toBe('Enter a value from -40 to 85 °C');
    expect(errorsOf({ ...hot, value: -40.1 }).value).toBe('Enter a value from -40 to 85 °C');
    expect(errorsOf({ ...hot, value: 85 }).value).toBeUndefined();
    expect(errorsOf({ ...hot, value: -40 }).value).toBeUndefined();
    expect(errorsOf({ ...hot, value: Number.NaN }).value).toBe('Enter a value');
  });

  it('holds the start to 0 s or more and the duration to above 0 and at most 3,600 s', () => {
    expect(errorsOf({ ...hot, startAt: -1 }).startAt).toBe('Start must be 0 s or more');
    expect(errorsOf({ ...hot, startAt: 0 }).startAt).toBeUndefined();
    expect(errorsOf({ ...hot, duration: 0 }).duration).toBe(
      'Duration must be above 0 s and at most 3600 s',
    );
    expect(errorsOf({ ...hot, duration: 3601 }).duration).toBeDefined();
    expect(errorsOf({ ...hot, duration: 3600 }).duration).toBeUndefined();
  });

  it('reports an overlap on the later anomaly only, and not for windows that touch', () => {
    const clash = validateDoc(docOf('ok', [hot, { ...hot, startAt: 50, duration: 10 }]), saved);
    expect(clash.entries['a1']).toBeUndefined();
    expect(clash.entries['a2']?.overlap).toBe(
      'dc-env-01 already has a fault on temperature_c in the scenario from 20 s to 80 s',
    );
    const touching = validateDoc(docOf('ok', [hot, { ...hot, startAt: 80, duration: 10 }]), saved);
    expect(touching.entries).toEqual({});
  });

  it('keeps entries with nothing wrong out of the result', () => {
    const errors = validateDoc(docOf('ok', [hot, { ...hot, startAt: -1, duration: 5 }]), saved);
    expect(Object.keys(errors.entries)).toEqual(['a2']);
  });
});

describe('problemSummary', () => {
  it('counts the problems of the document and of the anomalies together', () => {
    const one = validateDoc(docOf('', [hot]), saved);
    expect(problemSummary(one)).toBe('Fix 1 problem first');
    const added = addEntry(fromAnomalies([hot]), { ...hot, startAt: 200, duration: 5, value: 900 });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const two = validateDoc(setName(added.doc, ''), saved);
    expect(problemSummary(two)).toBe('Fix 2 problems first');
  });
});
