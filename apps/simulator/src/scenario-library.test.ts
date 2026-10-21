import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JsonFileDeviceSource } from './device-source.ts';
import type { ScenarioDocument } from './scenario-document.ts';
import {
  type FolderLoad,
  loadScenarioFolder,
  MAX_CUSTOM_SCENARIOS,
  MAX_SCENARIO_FILE_BYTES,
  ScenarioLibrary,
} from './scenario-library.ts';
import { BUILT_IN_SCENARIOS } from './scenarios.ts';
import { DEVICES } from './test-support.ts';

const root = mkdtempSync(join(tmpdir(), 'scenario-library-'));
after(() => rmSync(root, { recursive: true, force: true }));

let folders = 0;
/** A new empty folder for one case. */
function folder(): string {
  const dir = join(root, `case-${folders++}`);
  mkdirSync(dir);
  return dir;
}

/** A valid scenario for the test registry. */
const scenario = (name: string): ScenarioDocument => ({
  name,
  description: `The scenario ${name}.`,
  anomalies: [
    { deviceId: 'dc-env-01', metric: 'temperature_c', value: 29.2, startAt: 20, duration: 60 },
  ],
});

/** The same, as untyped JSON that a test may break. */
const document = (name: string, change: Record<string, unknown> = {}) => ({
  ...scenario(name),
  ...change,
});

function write(dir: string, file: string, content: unknown): void {
  writeFileSync(join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
}

/** The registry that ships with ingest: the built-ins are written for it. */
async function shippedDevices() {
  const path = fileURLToPath(new URL('../../ingest/config/devices.json', import.meta.url));
  return new JsonFileDeviceSource(path).load();
}

describe('loadScenarioFolder', () => {
  it('finds no scenarios and no problem in a folder that does not exist', () => {
    const loaded = loadScenarioFolder(join(root, 'nowhere'), { devices: DEVICES });
    assert.deepEqual(loaded, { scenarios: [], rejected: [] });
  });

  it('says so when the path is not a folder', () => {
    const dir = folder();
    write(dir, 'file.txt', 'x');
    const loaded = loadScenarioFolder(join(dir, 'file.txt'), { devices: DEVICES });
    assert.deepEqual(loaded.scenarios, []);
    assert.equal(loaded.rejected.length, 1);
    assert.match(loaded.rejected[0]?.reason ?? '', /^cannot read the folder \(ENOTDIR\)/);
  });

  it('reads valid files in name order and reports each file it cannot use, with the reason', () => {
    const dir = folder();
    write(dir, 'b-second.json', document('second'));
    write(dir, 'a-first.json', document('first'));
    write(dir, 'broken.json', '{ not json');
    write(dir, 'hot.json', document('hot', { anomalies: [] }));
    write(dir, 'far.json', {
      ...document('far'),
      anomalies: [
        { deviceId: 'ghost-01', metric: 'temperature_c', value: 1, startAt: 0, duration: 1 },
      ],
    });
    write(dir, 'notes.txt', 'ignored');
    mkdirSync(join(dir, 'folder.json'));

    const loaded = loadScenarioFolder(dir, { devices: DEVICES });

    assert.deepEqual(
      loaded.scenarios.map(({ file, scenario }) => [file, scenario.name]),
      [
        ['a-first.json', 'first'],
        ['b-second.json', 'second'],
      ],
    );
    assert.deepEqual(loaded.rejected, [
      { file: 'broken.json', reason: 'is not valid JSON' },
      { file: 'far.json', reason: 'anomalies[0]: unknown device "ghost-01"' },
      { file: 'hot.json', reason: 'anomalies must be a list of 1 to 50 anomalies' },
    ]);
  });

  it('refuses a file larger than the limit without reading it as a scenario', () => {
    const dir = folder();
    write(dir, 'big.json', JSON.stringify(document('big')) + ' '.repeat(MAX_SCENARIO_FILE_BYTES));
    write(dir, 'edge.json', JSON.stringify(document('edge')));
    const loaded = loadScenarioFolder(dir, { devices: DEVICES });
    assert.deepEqual(
      loaded.scenarios.map((s) => s.scenario.name),
      ['edge'],
    );
    assert.deepEqual(loaded.rejected, [
      { file: 'big.json', reason: `larger than ${MAX_SCENARIO_FILE_BYTES} bytes` },
    ]);
  });

  it('loads at most 200 files and says which were left out', () => {
    const dir = folder();
    for (let i = 0; i < MAX_CUSTOM_SCENARIOS + 1; i++) {
      const name = `s${String(i).padStart(3, '0')}`;
      write(dir, `${name}.json`, document(name));
    }
    const loaded = loadScenarioFolder(dir, { devices: DEVICES });
    assert.equal(loaded.scenarios.length, MAX_CUSTOM_SCENARIOS);
    assert.deepEqual(loaded.rejected, [
      { file: 's200.json', reason: 'not loaded: the folder holds more than 200 scenarios' },
    ]);
  });
});

describe('ScenarioLibrary: the built-ins', () => {
  it('keeps both built-ins against the registry that ships with ingest', async () => {
    const library = new ScenarioLibrary({
      builtIn: BUILT_IN_SCENARIOS,
      devices: await shippedDevices(),
    });
    assert.deepEqual(library.names(), ['server-room-overheat', 'crowded-lecture']);
    assert.deepEqual(library.rejected, []);
    assert.deepEqual(library.counts(), { builtIn: 2, custom: 0, imported: 0 });
    assert.equal(library.get('server-room-overheat')?.source, 'built-in');
    assert.equal(
      library.get('server-room-overheat')?.scenario.description,
      'Row A runs hot for a minute, then recovers.',
    );
  });

  it('rejects a built-in that names a device the registry in use lacks, and says why', () => {
    // The test registry has no lha-air-01, which crowded-lecture needs.
    const library = new ScenarioLibrary({ builtIn: BUILT_IN_SCENARIOS, devices: DEVICES });
    assert.deepEqual(library.names(), ['server-room-overheat']);
    assert.deepEqual(library.rejected, [
      { file: 'built-in:crowded-lecture', reason: 'anomalies[0]: unknown device "lha-air-01"' },
    ]);
  });
});

describe('ScenarioLibrary: the folder', () => {
  const builtIn = [scenario('overheat')];

  it('lists the built-ins first, then the folder in order, as custom and not imported', () => {
    const dir = folder();
    write(dir, 'b.json', document('beta'));
    write(dir, 'a.json', document('alpha'));
    const library = new ScenarioLibrary({
      builtIn,
      folder: loadScenarioFolder(dir, { devices: DEVICES }),
      devices: DEVICES,
    });
    assert.deepEqual(library.names(), ['overheat', 'alpha', 'beta']);
    assert.deepEqual(
      library.list().map((e) => [e.source, e.imported]),
      [
        ['built-in', false],
        ['custom', false],
        ['custom', false],
      ],
    );
    assert.deepEqual(library.counts(), { builtIn: 1, custom: 2, imported: 0 });
  });

  it('keeps the first of two scenarios with one name and rejects the other, by file', () => {
    const dir = folder();
    write(dir, 'a-overheat.json', document('overheat'));
    write(dir, 'b-twin.json', document('twin'));
    write(dir, 'c-twin.json', document('twin'));
    write(dir, 'd-broken.json', 'nope');
    const library = new ScenarioLibrary({
      builtIn,
      folder: loadScenarioFolder(dir, { devices: DEVICES }),
      devices: DEVICES,
    });
    assert.deepEqual(library.names(), ['overheat', 'twin']);
    assert.deepEqual(library.rejected, [
      { file: 'd-broken.json', reason: 'is not valid JSON' },
      { file: 'a-overheat.json', reason: 'the name "overheat" is already used' },
      { file: 'c-twin.json', reason: 'the name "twin" is already used' },
    ]);
  });
});

describe('ScenarioLibrary: names that every object has', () => {
  it('finds none of them unless a scenario really has the name', () => {
    const library = new ScenarioLibrary({ builtIn: [], devices: DEVICES });
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      assert.equal(library.get(name), undefined, name);
    }
    const imported = library.import(document('constructor'));
    assert.equal(imported.ok, true);
    assert.equal(library.get('constructor')?.scenario.name, 'constructor');
    assert.equal(library.get('__proto__'), undefined);
  });
});

describe('ScenarioLibrary.import', () => {
  const empty = () => new ScenarioLibrary({ builtIn: [], devices: DEVICES });

  it('keeps a valid scenario for the session as custom and imported, and writes nothing', () => {
    const library = empty();
    const result = library.import(document('imported-one'));
    assert.ok(result.ok);
    assert.equal(result.entry.source, 'custom');
    assert.equal(result.entry.imported, true);
    assert.deepEqual(library.names(), ['imported-one']);
    assert.deepEqual(library.counts(), { builtIn: 0, custom: 0, imported: 1 });
  });

  it('refuses an invalid document with the reason of the first check that fails', () => {
    const result = empty().import(
      document('hot', {
        anomalies: [
          { deviceId: 'dc-env-01', metric: 'temperature_c', value: 900, startAt: 0, duration: 10 },
        ],
      }),
    );
    assert.deepEqual(result, {
      ok: false,
      kind: 'invalid',
      reason: 'anomalies[0].value 900 is outside the range of temperature_c (-40 to 85 °C)',
    });
  });

  it('refuses the reserved name', () => {
    const result = empty().import(document('import'));
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.kind, 'invalid');
  });

  it('refuses a name that is taken, by a built-in or by an earlier import', () => {
    const library = new ScenarioLibrary({ builtIn: [scenario('overheat')], devices: DEVICES });
    assert.deepEqual(library.import(document('overheat')), {
      ok: false,
      kind: 'taken',
      reason: 'a scenario named "overheat" already exists',
    });
    assert.equal(library.import(document('again')).ok, true);
    const second = library.import(document('again'));
    assert.equal(!second.ok && second.kind, 'taken');
  });

  it('refuses the 201st custom scenario, counting the folder and the imports together', () => {
    const scenarios = Array.from({ length: MAX_CUSTOM_SCENARIOS - 1 }, (_, i) => ({
      file: `s${i}.json`,
      scenario: scenario(`s${i}`),
    }));
    const full: FolderLoad = { scenarios, rejected: [] };
    const library = new ScenarioLibrary({ builtIn: [], folder: full, devices: DEVICES });

    assert.equal(library.import(document('the-200th')).ok, true);
    const result = library.import(document('the-201st'));
    assert.deepEqual(result, {
      ok: false,
      kind: 'full',
      reason: 'there are already 200 custom scenarios',
    });
    assert.equal(library.get('the-201st'), undefined);
  });
});
