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
import { type ScenarioStore, ScenarioStoreError } from './scenario-store.ts';
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

/** A store in memory that records what it was asked, and can be made to fail. */
class FakeStore implements ScenarioStore {
  readonly files = new Map<string, ScenarioDocument>();
  readonly calls: { op: 'save' | 'remove'; file: string; replace?: boolean }[] = [];
  failure: Error | null = null;

  save(file: string, doc: ScenarioDocument, options: { replace: boolean }): void {
    this.calls.push({ op: 'save', file, replace: options.replace });
    if (this.failure) throw this.failure;
    if (!options.replace && this.files.has(file)) {
      throw new ScenarioStoreError('file-exists', `a file named ${file} is already in the folder`);
    }
    this.files.set(file, doc);
  }

  remove(file: string): void {
    this.calls.push({ op: 'remove', file });
    if (this.failure) throw this.failure;
    this.files.delete(file);
  }
}

describe('ScenarioLibrary.save', () => {
  const fresh = (builtIn: ScenarioDocument[] = []) => {
    const store = new FakeStore();
    return { store, library: new ScenarioLibrary({ builtIn, devices: DEVICES, store }) };
  };

  it('writes a new scenario to <name>.json and lists it as custom, not imported, after the others', () => {
    const { store, library } = fresh([scenario('overheat')]);
    const result = library.save(document('hot'));
    assert.ok(result.ok);
    assert.equal(result.created, true);
    assert.equal(result.entry.file, 'hot.json');
    assert.equal(result.entry.source, 'custom');
    assert.equal(result.entry.imported, false);
    assert.deepEqual(library.names(), ['overheat', 'hot']);
    assert.deepEqual(library.counts(), { builtIn: 1, custom: 1, imported: 0 });
    assert.deepEqual(store.calls, [{ op: 'save', file: 'hot.json', replace: false }]);
    assert.deepEqual(store.files.get('hot.json'), scenario('hot'));
  });

  it('replaces in the same place, in the file that already holds the name, even when that file is called otherwise', () => {
    const dir = folder();
    write(dir, 'foo.json', document('bar'));
    write(dir, 'other.json', document('other'));
    const store = new FakeStore();
    const library = new ScenarioLibrary({
      builtIn: [],
      folder: loadScenarioFolder(dir, { devices: DEVICES }),
      devices: DEVICES,
      store,
    });
    assert.deepEqual(library.names(), ['bar', 'other']);

    const result = library.save(document('bar', { description: 'changed' }));
    assert.ok(result.ok);
    assert.equal(result.created, false);
    assert.deepEqual(store.calls, [{ op: 'save', file: 'foo.json', replace: true }]);
    assert.equal(library.get('bar')?.scenario.description, 'changed');
    assert.equal(library.get('bar')?.file, 'foo.json');
    assert.deepEqual(library.names(), ['bar', 'other']);
  });

  it('turns an imported scenario into a file', () => {
    const { store, library } = fresh();
    assert.equal(library.import(document('session')).ok, true);
    const result = library.save(document('session', { description: 'kept' }));
    assert.ok(result.ok);
    assert.equal(result.created, false);
    assert.deepEqual(store.calls, [{ op: 'save', file: 'session.json', replace: false }]);
    assert.deepEqual(library.counts(), { builtIn: 0, custom: 1, imported: 0 });
  });

  it('refuses an invalid document with the validator’s reason and does not touch the store', () => {
    const { store, library } = fresh();
    const hot = document('hot', {
      anomalies: [
        { deviceId: 'dc-env-01', metric: 'temperature_c', value: 900, startAt: 0, duration: 10 },
      ],
    });
    assert.deepEqual(library.save(hot), {
      ok: false,
      kind: 'invalid',
      reason: 'anomalies[0].value 900 is outside the range of temperature_c (-40 to 85 °C)',
    });
    const reserved = library.save(document('import'));
    assert.equal(!reserved.ok && reserved.kind, 'invalid');
    assert.deepEqual(store.calls, []);
    assert.deepEqual(library.names(), []);
  });

  it('refuses the name of a built-in', () => {
    const { store, library } = fresh([scenario('overheat')]);
    const result = library.save(document('overheat'));
    assert.equal(!result.ok && result.kind, 'built-in');
    assert.match(!result.ok ? result.reason : '', /built-in scenario and is read-only/);
    assert.deepEqual(store.calls, []);
  });

  it('refuses the 201st custom scenario but still replaces one of the 200', () => {
    const scenarios = Array.from({ length: MAX_CUSTOM_SCENARIOS }, (_, i) => ({
      file: `s${i}.json`,
      scenario: scenario(`s${i}`),
    }));
    const store = new FakeStore();
    const library = new ScenarioLibrary({
      builtIn: [],
      folder: { scenarios, rejected: [] },
      devices: DEVICES,
      store,
    });
    assert.deepEqual(library.save(document('the-201st')), {
      ok: false,
      kind: 'full',
      reason: 'there are already 200 custom scenarios',
    });
    assert.equal(library.save(document('s7', { description: 'again' })).ok, true);
    assert.equal(library.names().length, MAX_CUSTOM_SCENARIOS);
    assert.deepEqual(store.calls, [{ op: 'save', file: 's7.json', replace: true }]);
  });

  it('refuses a new name whose file is already in the folder and changes nothing', () => {
    const { store, library } = fresh();
    store.files.set('hot.json', scenario('somebody-elses'));
    const result = library.save(document('hot'));
    assert.equal(!result.ok && result.kind, 'file-exists');
    assert.equal(library.get('hot'), undefined);
    assert.deepEqual(store.files.get('hot.json'), scenario('somebody-elses'));
  });

  it('passes on what the store refuses, and a refusal changes nothing', () => {
    const { store, library } = fresh();
    assert.equal(library.save(document('first')).ok, true);
    const before = library.list().map((entry) => [entry.scenario.name, entry.file]);

    for (const [kind, reason] of [
      ['too-large', 'the scenario is 20000 bytes as a file'],
      ['unwritable', 'cannot write second.json in the scenarios folder (EROFS)'],
    ] as const) {
      store.failure = new ScenarioStoreError(kind, reason);
      assert.deepEqual(library.save(document('second')), { ok: false, kind, reason });
      const replacing = library.save(document('first', { description: 'new text' }));
      assert.equal(!replacing.ok && replacing.kind, kind);
    }
    assert.deepEqual(
      library.list().map((entry) => [entry.scenario.name, entry.file]),
      before,
    );
    assert.equal(library.get('first')?.scenario.description, 'The scenario first.');
  });

  it('does not hide a failure that is not the store’s', () => {
    const { store, library } = fresh();
    store.failure = new TypeError('a bug');
    assert.throws(() => library.save(document('hot')), TypeError);
    assert.equal(library.get('hot'), undefined);
  });

  it('says so when there is no folder to write to', () => {
    const library = new ScenarioLibrary({ builtIn: [], devices: DEVICES });
    assert.deepEqual(library.save(document('hot')), {
      ok: false,
      kind: 'unwritable',
      reason: 'no scenarios folder is in use',
    });
  });

  it('treats a name every object has as a name like any other', () => {
    const { store, library } = fresh();
    assert.equal(library.save(document('constructor')).ok, true);
    assert.deepEqual(store.calls, [{ op: 'save', file: 'constructor.json', replace: false }]);
    assert.equal(library.get('constructor')?.scenario.name, 'constructor');
    assert.equal(library.get('toString'), undefined);
    // `__proto__` is not a valid name at all.
    const proto = library.save(document('__proto__'));
    assert.equal(!proto.ok && proto.kind, 'invalid');
  });
});

describe('ScenarioLibrary.remove', () => {
  it('removes the file that holds the scenario, then the scenario', () => {
    const dir = folder();
    write(dir, 'foo.json', document('bar'));
    const store = new FakeStore();
    const library = new ScenarioLibrary({
      builtIn: [],
      folder: loadScenarioFolder(dir, { devices: DEVICES }),
      devices: DEVICES,
      store,
    });
    assert.deepEqual(library.remove('bar'), { ok: true });
    assert.deepEqual(store.calls, [{ op: 'remove', file: 'foo.json' }]);
    assert.deepEqual(library.names(), []);
  });

  it('removes a saved scenario’s file, and an imported scenario without asking the store', () => {
    const store = new FakeStore();
    const library = new ScenarioLibrary({ builtIn: [], devices: DEVICES, store });
    assert.equal(library.save(document('saved')).ok, true);
    assert.equal(library.import(document('session')).ok, true);

    assert.deepEqual(library.remove('session'), { ok: true });
    assert.deepEqual(store.calls, [{ op: 'save', file: 'saved.json', replace: false }]);
    assert.deepEqual(library.remove('saved'), { ok: true });
    assert.deepEqual(store.calls.at(-1), { op: 'remove', file: 'saved.json' });
    assert.deepEqual(library.names(), []);
  });

  it('refuses a built-in and an unknown name, including names every object has', () => {
    const library = new ScenarioLibrary({
      builtIn: [scenario('overheat')],
      devices: DEVICES,
      store: new FakeStore(),
    });
    const builtIn = library.remove('overheat');
    assert.equal(!builtIn.ok && builtIn.kind, 'built-in');
    for (const name of ['nope', 'toString', '__proto__', 'constructor']) {
      const result = library.remove(name);
      assert.equal(!result.ok && result.kind, 'not-found', name);
    }
    assert.deepEqual(library.names(), ['overheat']);
  });

  it('keeps the scenario when its file cannot be removed', () => {
    const store = new FakeStore();
    const library = new ScenarioLibrary({ builtIn: [], devices: DEVICES, store });
    assert.equal(library.save(document('saved')).ok, true);
    store.failure = new ScenarioStoreError('unwritable', 'cannot remove saved.json (EACCES)');
    assert.deepEqual(library.remove('saved'), {
      ok: false,
      kind: 'unwritable',
      reason: 'cannot remove saved.json (EACCES)',
    });
    assert.deepEqual(library.names(), ['saved']);
  });

  it('says so when a scenario read from a file cannot be removed because there is no store', () => {
    const dir = folder();
    write(dir, 'a.json', document('alpha'));
    const library = new ScenarioLibrary({
      builtIn: [],
      folder: loadScenarioFolder(dir, { devices: DEVICES }),
      devices: DEVICES,
    });
    const result = library.remove('alpha');
    assert.equal(!result.ok && result.kind, 'unwritable');
    assert.deepEqual(library.names(), ['alpha']);
  });
});
